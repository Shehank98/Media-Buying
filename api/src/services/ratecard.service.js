// ─── Channel rate cards on Google Drive ──────────────────────────────────────
// A channel's rate card (one PDF per channel) is uploaded to Google Drive using
// the same auth as the database backup — OAuth user creds (the signed-in user's
// own Drive) or a service account. Only the Drive file id + metadata are stored
// in the DB (ChannelMaster.rateCard*).
//
// Env:
//   GDRIVE_RATECARD_FOLDER_ID    Drive folder for rate cards. Falls back to
//                                GDRIVE_BACKUP_FOLDER_ID; optional with OAuth
//                                (defaults to My Drive root).
//   (reuses the Drive auth: GOOGLE_OAUTH_* or GOOGLE_SERVICE_ACCOUNT_JSON)

import { hasDriveAuth, oauthConfigured, getDriveAccessToken, ensureFolder } from './backup.service.js';

export function isRateCardConfigured() {
  // OAuth → folder optional (auto-creates "Orbit Rate Cards"). Service account →
  // a rate-card or backup folder id is required.
  if (oauthConfigured()) return true;
  return !!(hasDriveAuth() && (process.env.GDRIVE_RATECARD_FOLDER_ID || process.env.GDRIVE_BACKUP_FOLDER_ID));
}

// The top rate-card folder: the configured id, else an app-owned "Orbit Rate Cards".
async function ratecardTopFolder(token) {
  return process.env.GDRIVE_RATECARD_FOLDER_ID || ensureFolder('Orbit Rate Cards', null, token);
}

// Accepted rate-card formats → MIME type. Rate cards may be PDF, image, or Excel
// (and common office variants). Keyed by lowercase extension (no dot).
export const RATE_CARD_MIME = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
export function extOf(fileName) {
  const m = /\.([a-z0-9]+)$/i.exec(String(fileName || '').trim());
  return m ? m[1].toLowerCase() : '';
}
export function mimeForFile(fileName) {
  return RATE_CARD_MIME[extOf(fileName)] || 'application/octet-stream';
}
export function isAllowedRateCard(fileName) {
  return Object.prototype.hasOwnProperty.call(RATE_CARD_MIME, extOf(fileName));
}

// Auto-generated rate-card file name: "<Channel>_<Medium>_<YYYY-MM-DD>.<ext>".
// Uploads are renamed to this regardless of the original file name (drops any
// path-illegal characters; keeps the real extension so any format still opens).
export function rateCardName(channel, medium, ext, date = new Date()) {
  const clean = (s) => String(s || '').trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();
  const day = (date instanceof Date ? date : new Date(date)).toISOString().slice(0, 10);
  const base = [clean(channel), clean(medium), day].filter(Boolean).join('_');
  return `${base}.${ext || 'pdf'}`;
}

// Upload a rate-card Buffer (any format — PDF/JPG/PNG/Excel/…) into a nested
// folder chain under the top rate-card folder, e.g.
//   General Rate Cards/<channel>/           (general, per channel master)
//   Client Rate Cards/<client>/<channel>/   (client-specific)
// Returns { id, size, name }. Callers keep every upload as a new version (no
// delete) so history is preserved in Drive.
export async function uploadRateCard(buffer, fileName, { folders = [], mimeType = 'application/octet-stream' } = {}) {
  if (!isRateCardConfigured()) throw new Error('Rate card storage is not configured');
  const token = await getDriveAccessToken();
  let parent = await ratecardTopFolder(token);
  for (const f of folders) {
    if (f == null || f === '') continue;
    parent = await ensureFolder(String(f).slice(0, 120), parent, token);
  }

  const metadata = { name: fileName, parents: [parent] };
  const boundary = 'orbitrc_' + Date.now().toString(36);
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

// Fetch a rate card PDF as a Buffer for proxying to the browser.
export async function downloadRateCard(driveId) {
  if (!isRateCardConfigured()) throw new Error('Rate card storage is not configured');
  const token = await getDriveAccessToken();
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${driveId}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Drive download failed (${resp.status}): ${t.slice(0, 400)}`);
  }
  const arr = await resp.arrayBuffer();
  return Buffer.from(arr);
}

// Best-effort delete (used when replacing or clearing a rate card).
export async function deleteRateCard(driveId) {
  if (!driveId || !isRateCardConfigured()) return false;
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
