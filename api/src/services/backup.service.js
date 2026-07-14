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
//                                in a normal "My Drive" - service accounts have
//                                no storage quota of their own, so without this
//                                the folder must be on a Shared Drive.
//   BACKUP_CRON                  Cron expression (default "0 2 * * *" = 02:00 daily).
//   BACKUP_RETENTION             How many recent backups to keep in the folder
//                                (default 30). Older ones are pruned after each run.
//   PGDUMP_PATH                  Path to the pg_dump binary (default "pg_dump").
//   BACKUP_TZ                    Timezone for the cron schedule (default "Asia/Colombo").

import { spawn } from 'child_process';
import { createGzip, createGunzip } from 'zlib';
import { createWriteStream, createReadStream, promises as fsp } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import cron from 'node-cron';
import { JWT, OAuth2Client } from 'google-auth-library';

const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive'];
const FILE_PREFIX = 'orbit-backup-';

// Last run outcome, exposed via the status endpoint (in-memory, resets on deploy).
let lastRun = null;   // { status, at, fileName, fileId, sizeBytes, error, durationMs }
let running = false;

export function loadServiceAccount() {
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

// OAuth (user) credentials - lets the app upload to the signed-in user's own
// Google Drive (their free 15 GB), which a service account cannot do. Set all
// three to use OAuth; it takes precedence over the service account.
export function oauthConfigured() {
  return !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET && process.env.GOOGLE_OAUTH_REFRESH_TOKEN);
}

// Any Drive auth available (OAuth user creds or a service account)?
export function hasDriveAuth() {
  return oauthConfigured() || !!loadServiceAccount();
}

export function isBackupConfigured() {
  // OAuth → files go to the user's Drive (folder optional, defaults to My Drive
  // root). Service account → a Shared-Drive folder id is required.
  if (oauthConfigured()) return true;
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

export async function getDriveAccessToken() {
  // Prefer OAuth user creds (upload to the user's own Drive); else service account.
  if (oauthConfigured()) {
    const client = new OAuth2Client(process.env.GOOGLE_OAUTH_CLIENT_ID, process.env.GOOGLE_OAUTH_CLIENT_SECRET);
    client.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN });
    const { token } = await client.getAccessToken();
    if (!token) throw new Error('Failed to obtain Google access token (OAuth). Re-run the refresh-token setup.');
    return token;
  }
  const sa = loadServiceAccount();
  if (!sa) throw new Error('No Google Drive auth configured (set OAuth creds or a service account)');
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

// Find-or-create a subfolder by `name` under `parentId` (or My Drive root when
// null). With the drive.file scope the app only sees folders it created - which
// is exactly what we want: it reuses its own folder tree across runs. Returns
// the folder id. Shared by backups (date folders) and rate cards (medium/channel).
export async function ensureFolder(name, parentId, token) {
  const safe = String(name).replace(/['\\]/g, ' ').trim() || 'Untitled';
  const clause = parentId ? `'${parentId}' in parents and ` : '';
  const q = encodeURIComponent(`${clause}mimeType = 'application/vnd.google-apps.folder' and name = '${safe}' and trashed = false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const findResp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (findResp.ok) {
    const { files = [] } = await findResp.json();
    if (files[0]?.id) return files[0].id;
  }
  const metadata = { name: safe, mimeType: 'application/vnd.google-apps.folder', ...(parentId ? { parents: [parentId] } : {}) };
  const createResp = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  });
  if (!createResp.ok) throw new Error(`Failed to create Drive folder "${safe}" (${createResp.status})`);
  return (await createResp.json()).id;
}

// The top backup folder: the configured id, else an app-owned "Orbit Backups".
async function backupTopFolder(token) {
  return process.env.GDRIVE_BACKUP_FOLDER_ID || ensureFolder('Orbit Backups', null, token);
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

// Create a fresh gzipped full-database dump in a temp file. Returns its path,
// name and size. Used by both the scheduled/Drive backup and the on-demand
// download endpoint (which works even when Drive is not configured).
export async function createDumpFile() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${FILE_PREFIX}${stamp}.sql.gz`;
  const localPath = path.join(tmpdir(), fileName);
  const sizeBytes = await dumpDatabase(localPath);
  return { localPath, fileName, sizeBytes };
}

// Small helper: run a one-off psql command, capturing stderr on failure.
function runPsql(bin, url, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, [...args, '--dbname=' + url], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('error', (err) => reject(new Error(`psql failed to start: ${err.message}`)));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`psql exited ${code}: ${stderr.slice(-800)}`))));
  });
}

// Restore the WHOLE database from a dump file (plain SQL, optionally gzipped).
// The public schema is dropped and recreated first, so the restore is a clean
// replace of everything - every table, every setting, every number - regardless
// of whether the dump was taken with --clean. Uses psql (postgresql-client).
export async function restoreDatabase(localPath) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const psqlBin = process.env.PSQL_PATH || 'psql';

  // 1) Reset the schema to a clean slate so the dump can recreate everything.
  await runPsql(psqlBin, url, ['-v', 'ON_ERROR_STOP=1', '-c',
    'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;']);

  // 2) Stream the dump (gunzip on the fly for .gz) into psql.
  const isGz = /\.gz$/i.test(localPath);
  await new Promise((resolve, reject) => {
    const psql = spawn(psqlBin, ['-v', 'ON_ERROR_STOP=1', '--dbname=' + url], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    psql.stderr.on('data', (d) => { stderr += d.toString(); });
    psql.on('error', (err) => reject(new Error(`psql failed to start: ${err.message}`)));
    psql.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`psql restore exited ${code}: ${stderr.slice(-800)}`));
    });
    const src = createReadStream(localPath);
    src.on('error', (err) => { try { psql.kill(); } catch { /* ignore */ } reject(err); });
    if (isGz) {
      const gunzip = createGunzip();
      gunzip.on('error', (err) => { try { psql.kill(); } catch { /* ignore */ } reject(err); });
      src.pipe(gunzip).pipe(psql.stdin);
    } else {
      src.pipe(psql.stdin);
    }
  });
}

// Download a Drive file (by id) to a local temp path. Returns the path.
export async function downloadDriveFile(fileId, token) {
  const dest = path.join(tmpdir(), `${FILE_PREFIX}restore-${Date.now()}.sql.gz`);
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Drive download failed (${resp.status}): ${t.slice(0, 300)}`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  await fsp.writeFile(dest, buf);
  return dest;
}

// Multipart upload of a local file to the Drive folder. Returns the file resource.
async function uploadToDrive(localPath, fileName, token, parentId) {
  // Upload into the given folder (a date subfolder); root if none resolved.
  const metadata = parentId ? { name: fileName, parents: [parentId] } : { name: fileName };
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
  // Backups now live in date subfolders, so match by the unique name prefix
  // (drive.file scope only surfaces the app's own files anyway).
  const q = encodeURIComponent(`name contains '${FILE_PREFIX}' and trashed = false`);
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
  const token = await getDriveAccessToken();
  const q = encodeURIComponent(`name contains '${FILE_PREFIX}' and trashed = false`);
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
    const token = await getDriveAccessToken();
    // Organize as <backup folder>/<YYYY-MM-DD>/orbit-backup-….sql.gz
    const top = await backupTopFolder(token);
    const dateFolder = await ensureFolder(new Date().toISOString().slice(0, 10), top, token);
    const file = await uploadToDrive(localPath, fileName, token, dateFolder);
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
    console.log('[backup] disabled - set OAuth creds (GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN) or a service account (GOOGLE_SERVICE_ACCOUNT_JSON + GDRIVE_BACKUP_FOLDER_ID) to enable daily Google Drive backups');
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
