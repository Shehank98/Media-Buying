// ─── Property evaluation documents on Google Drive ───────────────────────────
// A property's evaluation document (PDF or Excel) is uploaded to Google Drive
// using the same auth as the database backup / rate cards (OAuth user creds or a
// service account). Files are organised as:
//
//   Property Evaluations / <Client> / <Channel> / <file>
//
// Only the Drive file id + metadata are stored in the DB (Property.evaluation*).
//
// Env:
//   GDRIVE_EVALUATION_FOLDER_ID   Drive folder for evaluations. Falls back to
//                                 GDRIVE_BACKUP_FOLDER_ID; optional with OAuth
//                                 (auto-creates "Property Evaluations").
//   (reuses the Drive auth: GOOGLE_OAUTH_* or GOOGLE_SERVICE_ACCOUNT_JSON)

import { hasDriveAuth, oauthConfigured, getDriveAccessToken, ensureFolder } from './backup.service.js';

// Only PDF + Excel are accepted for evaluations (keyed by lowercase ext, no dot).
export const EVALUATION_MIME = {
  pdf: 'application/pdf',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function extOf(fileName) {
  const m = /\.([a-z0-9]+)$/i.exec(String(fileName || '').trim());
  return m ? m[1].toLowerCase() : '';
}
export function mimeForEvaluation(fileName) {
  return EVALUATION_MIME[extOf(fileName)] || 'application/octet-stream';
}
export function isAllowedEvaluation(fileName) {
  return Object.prototype.hasOwnProperty.call(EVALUATION_MIME, extOf(fileName));
}

export function isEvaluationConfigured() {
  if (oauthConfigured()) return true;
  return !!(hasDriveAuth() && (process.env.GDRIVE_EVALUATION_FOLDER_ID || process.env.GDRIVE_BACKUP_FOLDER_ID));
}

// The top evaluations folder: the configured id, else an app-owned "Property Evaluations".
async function evaluationTopFolder(token) {
  return process.env.GDRIVE_EVALUATION_FOLDER_ID || ensureFolder('Property Evaluations', null, token);
}

// Auto-generated file name: "<Property>_<YYYY-MM-DD>.<ext>" (drops illegal chars).
export function evaluationName(property, ext, date = new Date()) {
  const clean = (s) => String(s || '').trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();
  const day = (date instanceof Date ? date : new Date(date)).toISOString().slice(0, 10);
  const base = [clean(property) || 'Evaluation', day].filter(Boolean).join('_');
  return `${base}.${ext || 'pdf'}`;
}

// Upload an evaluation Buffer into Property Evaluations/<client>/<channel>/.
// Returns { id, name, size }.
export async function uploadEvaluation(buffer, fileName, { client, channel, mimeType = 'application/octet-stream' } = {}) {
  if (!isEvaluationConfigured()) throw new Error('Evaluation storage is not configured');
  const token = await getDriveAccessToken();
  let parent = await evaluationTopFolder(token);
  for (const f of [client, channel]) {
    if (f == null || f === '') continue;
    parent = await ensureFolder(String(f).slice(0, 120), parent, token);
  }

  const metadata = { name: fileName, parents: [parent] };
  const boundary = 'orbiteval_' + Date.now().toString(36);
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
  if (!resp.ok) throw new Error(`Drive upload failed (${resp.status}): ${(await resp.text()).slice(0, 400)}`);
  const file = await resp.json();
  return { id: file.id, name: file.name, size: Number(file.size) || buffer.length };
}

// Fetch an evaluation as a Buffer for proxying to the browser.
export async function downloadEvaluation(driveId) {
  if (!isEvaluationConfigured()) throw new Error('Evaluation storage is not configured');
  const token = await getDriveAccessToken();
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${driveId}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!resp.ok) throw new Error(`Drive download failed (${resp.status}): ${(await resp.text()).slice(0, 400)}`);
  return Buffer.from(await resp.arrayBuffer());
}

// Best-effort delete (used when replacing or clearing an evaluation).
export async function deleteEvaluation(driveId) {
  if (!driveId || !isEvaluationConfigured()) return false;
  try {
    const token = await getDriveAccessToken();
    const resp = await fetch(
      `https://www.googleapis.com/drive/v3/files/${driveId}?supportsAllDrives=true`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
    );
    return resp.ok || resp.status === 204;
  } catch {
    return false;
  }
}
