// ─── Schedule-log yearly archive to Google Drive ────────────────────────────
// Exports a full year of ScheduleLog rows (all columns) to an Excel file in
// Google Drive under Orbit Schedule Logs/<year>/. A backup/archive only — the
// rows stay in the database. Reuses the same Drive auth as the DB backup.
import { getDriveAccessToken, ensureFolder, hasDriveAuth, oauthConfigured } from './backup.service.js';

export function isDriveArchiveConfigured() {
  if (oauthConfigured()) return true;
  return !!(hasDriveAuth() && (process.env.GDRIVE_SCHEDULE_FOLDER_ID || process.env.GDRIVE_BACKUP_FOLDER_ID || process.env.GDRIVE_RATECARD_FOLDER_ID));
}

// Top folder: the configured id, else an app-owned "Orbit Schedule Logs".
async function topFolder(token) {
  return process.env.GDRIVE_SCHEDULE_FOLDER_ID || ensureFolder('Orbit Schedule Logs', null, token);
}

// Upload an .xlsx Buffer to Orbit Schedule Logs/<year>/<fileName>.
export async function uploadScheduleArchive(buffer, fileName, year) {
  if (!isDriveArchiveConfigured()) throw new Error('Google Drive is not configured');
  const token = await getDriveAccessToken();
  let parent = await topFolder(token);
  parent = await ensureFolder(String(year), parent, token);

  const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const metadata = { name: fileName, parents: [parent] };
  const boundary = 'orbitsl_' + Date.now().toString(36);
  const pre = Buffer.from(
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) + '\r\n' +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`,
    'utf8',
  );
  const post = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const payload = Buffer.concat([pre, buffer, post]);

  const resp = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,size',
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
    throw new Error(`Drive upload failed (${resp.status}): ${t.slice(0, 400)}`);
  }
  const file = await resp.json();
  return { id: file.id, name: file.name, size: Number(file.size) || buffer.length };
}
