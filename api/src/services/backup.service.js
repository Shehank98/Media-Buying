// ─── Database backup to Google Drive ──────────────────────────────────────────
// Dumps the whole PostgreSQL database with pg_dump, gzips it, and uploads the
// archive to a Google Drive folder using a service account. Runs on a daily
// schedule (node-cron) and can be triggered manually by a SUPER_ADMIN.
//
// Required environment variables (backup stays DISABLED until they are set):
//   GOOGLE_SERVICE_ACCOUNT_JSON  Service-account key. Either the raw JSON string
//                                or the same JSON base64-encoded (handy for
//                                single-line env values).
//   GDRIVE_BACKUP_FOLDER_ID      ID of the Drive folder to upload into. Share
//                                that folder with the service-account email
//                                (client_email) as Editor.
// Optional:
//   GOOGLE_IMPERSONATE_SUBJECT   A Workspace user to impersonate (domain-wide
//                                delegation). Needed if the target folder lives
//                                in a normal "My Drive" — service accounts have
//                                no storage quota of their own, so without this
//                                the folder must be on a Shared Drive.
//   BACKUP_CRON                  Cron expression (default "0 2 * * *" = 02:00 daily).
//   BACKUP_RETENTION             How many recent backups to keep in the folder
//                                (default 30). Older ones are pruned after each run.
//   PGDUMP_PATH                  Path to the pg_dump binary (default "pg_dump").
//   BACKUP_TZ                    Timezone for the cron schedule (default "Asia/Colombo").

import { spawn } from 'child_process';
import { createGzip } from 'zlib';
import { createWriteStream, createReadStream, promises as fsp } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import cron from 'node-cron';
import { JWT } from 'google-auth-library';

const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive'];
const FILE_PREFIX = 'orbit-backup-';

// Last run outcome, exposed via the status endpoint (in-memory, resets on deploy).
let lastRun = null;   // { status, at, fileName, fileId, sizeBytes, error, durationMs }
let running = false;

function loadServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  let text = raw.trim();
  if (!text.startsWith('{')) {
    // Assume base64-encoded JSON.
    try { text = Buffer.from(text, 'base64').toString('utf8'); } catch { return null; }
  }
  try {
    const json = JSON.parse(text);
    if (!json.client_email || !json.private_key) return null;
    return json;
  } catch {
    return null;
  }
}

export function isBackupConfigured() {
  return !!(loadServiceAccount() && process.env.GDRIVE_BACKUP_FOLDER_ID);
}

export function getBackupStatus() {
  return {
    configured: isBackupConfigured(),
    running,
    schedule: process.env.BACKUP_CRON || '0 2 * * *',
    retention: parseInt(process.env.BACKUP_RETENTION || '30', 10),
    lastRun,
  };
}

async function getAccessToken() {
  const sa = loadServiceAccount();
  if (!sa) throw new Error('Service account not configured');
  const client = new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: DRIVE_SCOPES,
    subject: process.env.GOOGLE_IMPERSONATE_SUBJECT || undefined,
  });
  const { token } = await client.getAccessToken();
  if (!token) throw new Error('Failed to obtain Google access token');
  return token;
}

// Run pg_dump | gzip → destPath. Resolves with the byte size written.
function dumpDatabase(destPath) {
  return new Promise((resolve, reject) => {
    const url = process.env.DATABASE_URL;
    if (!url) return reject(new Error('DATABASE_URL is not set'));
    const bin = process.env.PGDUMP_PATH || 'pg_dump';
    const dump = spawn(bin, ['--no-owner', '--no-privileges', '--format=plain', '--dbname=' + url], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    dump.stderr.on('data', (d) => { stderr += d.toString(); });
    dump.on('error', (err) => reject(new Error(`pg_dump failed to start: ${err.message}`)));

    const gzip = createGzip();
    const out = createWriteStream(destPath);
    dump.stdout.pipe(gzip).pipe(out);

    let dumpExited = false;
    dump.on('close', (code) => {
      dumpExited = true;
      if (code !== 0) {
        gzip.destroy();
        reject(new Error(`pg_dump exited ${code}: ${stderr.slice(0, 500)}`));
      }
    });
    out.on('error', (err) => reject(err));
    out.on('finish', async () => {
      if (!dumpExited) return; // wait for dump close; if it errored we already rejected
      try {
        const st = await fsp.stat(destPath);
        resolve(st.size);
      } catch (err) { reject(err); }
    });
  });
}

// Multipart upload of a local file to the Drive folder. Returns the file resource.
async function uploadToDrive(localPath, fileName, token) {
  const folderId = process.env.GDRIVE_BACKUP_FOLDER_ID;
  const metadata = { name: fileName, parents: [folderId] };
  const boundary = 'orbit_' + Date.now().toString(36);
  const body = await fsp.readFile(localPath);

  const pre = Buffer.from(
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) + '\r\n' +
    `--${boundary}\r\n` +
    'Content-Type: application/gzip\r\n\r\n',
    'utf8',
  );
  const post = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const payload = Buffer.concat([pre, body, post]);

  const resp = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,size,createdTime',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(payload.length),
      },
      body: payload,
    },
  );
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Drive upload failed (${resp.status}): ${t.slice(0, 500)}`);
  }
  return resp.json();
}

// Keep only the newest `retention` backups in the folder; delete the rest.
async function pruneOldBackups(token) {
  const retention = parseInt(process.env.BACKUP_RETENTION || '30', 10);
  if (!(retention > 0)) return 0;
  const folderId = process.env.GDRIVE_BACKUP_FOLDER_ID;
  const q = encodeURIComponent(`'${folderId}' in parents and name contains '${FILE_PREFIX}' and trashed = false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=createdTime desc&pageSize=1000&fields=files(id,name,createdTime)&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) return 0;
  const { files = [] } = await resp.json();
  const stale = files.slice(retention);
  let deleted = 0;
  for (const f of stale) {
    const d = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?supportsAllDrives=true`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (d.ok || d.status === 204) deleted += 1;
  }
  return deleted;
}

// List recent backups already in the folder (for the status view).
export async function listBackups(limit = 15) {
  if (!isBackupConfigured()) return [];
  const token = await getAccessToken();
  const folderId = process.env.GDRIVE_BACKUP_FOLDER_ID;
  const q = encodeURIComponent(`'${folderId}' in parents and name contains '${FILE_PREFIX}' and trashed = false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=createdTime desc&pageSize=${limit}&fields=files(id,name,size,createdTime)&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`Failed to list backups (${resp.status})`);
  const { files = [] } = await resp.json();
  return files;
}

// Run one full backup: dump → gzip → upload → prune. Returns the outcome.
export async function runBackup({ trigger = 'manual' } = {}) {
  if (!isBackupConfigured()) {
    const err = 'Backup is not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON and GDRIVE_BACKUP_FOLDER_ID.';
    lastRun = { status: 'failed', at: new Date().toISOString(), error: err, trigger };
    throw new Error(err);
  }
  if (running) throw new Error('A backup is already in progress');
  running = true;
  const startedAt = Date.now();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${FILE_PREFIX}${stamp}.sql.gz`;
  const localPath = path.join(tmpdir(), fileName);
  try {
    const sizeBytes = await dumpDatabase(localPath);
    const token = await getAccessToken();
    const file = await uploadToDrive(localPath, fileName, token);
    let pruned = 0;
    try { pruned = await pruneOldBackups(token); } catch { /* pruning is best-effort */ }
    lastRun = {
      status: 'success', at: new Date().toISOString(), fileName,
      fileId: file.id, sizeBytes, pruned, durationMs: Date.now() - startedAt, trigger,
    };
    console.log(`[backup] uploaded ${fileName} (${(sizeBytes / 1024).toFixed(1)} KB), pruned ${pruned} old`);
    return lastRun;
  } catch (err) {
    lastRun = { status: 'failed', at: new Date().toISOString(), fileName, error: err.message, durationMs: Date.now() - startedAt, trigger };
    console.error('[backup] failed:', err.message);
    throw err;
  } finally {
    running = false;
    fsp.unlink(localPath).catch(() => {});
  }
}

// Start the daily cron. No-op (with a log) when backup is not configured.
export function startBackupScheduler() {
  const expr = process.env.BACKUP_CRON || '0 2 * * *';
  if (!isBackupConfigured()) {
    console.log('[backup] disabled — set GOOGLE_SERVICE_ACCOUNT_JSON + GDRIVE_BACKUP_FOLDER_ID to enable daily Google Drive backups');
    return;
  }
  if (!cron.validate(expr)) {
    console.error(`[backup] invalid BACKUP_CRON "${expr}"; scheduler not started`);
    return;
  }
  cron.schedule(expr, () => {
    runBackup({ trigger: 'schedule' }).catch(() => {});
  }, { timezone: process.env.BACKUP_TZ || 'Asia/Colombo' });
  console.log(`[backup] scheduled daily Google Drive backup (cron "${expr}")`);
}
