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

// Upload a PDF Buffer into RateCards/<medium>/<channel>/. Returns { id, size,
// name }. Callers keep every upload as a new version (no delete) so history is
// preserved in Drive.
export async function uploadRateCard(buffer, fileName, { medium, channel } = {}) {
  if (!isRateCardConfigured()) throw new Error('Rate card storage is not configured');
  const token = await getDriveAccessToken();
  let parent = await ratecardTopFolder(token);
  if (medium) parent = await ensureFolder(String(medium), parent, token);
  if (channel) parent = await ensureFolder(String(channel).slice(0, 120), parent, token);

  const metadata = { name: fileName, parents: [parent] };
  const boundary = 'orbitrc_' + Date.now().toString(36);
  const pre = Buffer.from(
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) + '\r\n' +
    `--${boundary}\r\n` +
    'Content-Type: application/pdf\r\n\r\n',
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
