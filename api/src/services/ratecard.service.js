// ─── Channel rate cards on Google Drive ──────────────────────────────────────
// A channel's rate card (one PDF per channel) is uploaded to a dedicated Google
// Drive folder using the same service account as the database backup. Only the
// Drive file id + metadata are stored in the DB (ChannelMaster.rateCard*).
//
// Env:
//   GDRIVE_RATECARD_FOLDER_ID    Drive folder for rate cards. Falls back to
//                                GDRIVE_BACKUP_FOLDER_ID when unset. Share it with
//                                the service-account client_email as Editor.
//   (reuses GOOGLE_SERVICE_ACCOUNT_JSON + GOOGLE_IMPERSONATE_SUBJECT)

import { loadServiceAccount, getDriveAccessToken } from './backup.service.js';

function rateCardFolderId() {
  return process.env.GDRIVE_RATECARD_FOLDER_ID || process.env.GDRIVE_BACKUP_FOLDER_ID || null;
}

export function isRateCardConfigured() {
  return !!(loadServiceAccount() && rateCardFolderId());
}

// Upload a PDF Buffer as a new Drive file. Returns { id, size, name }.
export async function uploadRateCard(buffer, fileName) {
  const folderId = rateCardFolderId();
  if (!folderId) throw new Error('Rate card storage is not configured');
  const token = await getDriveAccessToken();

  const metadata = { name: fileName, parents: [folderId] };
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
