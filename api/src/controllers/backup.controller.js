import { promises as fsp, createReadStream } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  runBackup, getBackupStatus, listBackups, isBackupConfigured,
  createDumpFile, restoreDatabase, downloadDriveFile, getDriveAccessToken,
} from '../services/backup.service.js';
import { runDataExport, getDataExportStatus } from '../services/dataExport.service.js';

// GET /api/admin/backup/data-export/status - per-tab Excel export status + config.
export async function dataExportStatus(req, res) {
  try {
    return res.json(getDataExportStatus());
  } catch (error) {
    console.error('dataExportStatus error:', error);
    return res.status(500).json({ error: 'Failed to read data-export status', detail: error.message });
  }
}

// POST /api/admin/backup/data-export/run - trigger the per-tab Excel export now.
export async function triggerDataExport(req, res) {
  if (!isBackupConfigured()) {
    return res.status(400).json({ error: 'Data export needs the Google Drive backup to be configured first.' });
  }
  try {
    const result = await runDataExport({ trigger: 'manual' });
    return res.json({ message: 'Data export completed', result });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// GET /api/admin/backup/status - configuration + last run + recent backups.
export async function backupStatus(req, res) {
  try {
    const status = getBackupStatus();
    let backups = [];
    if (status.configured) {
      try { backups = await listBackups(15); } catch (e) { status.listError = e.message; }
    }
    return res.json({ ...status, backups });
  } catch (error) {
    console.error('backupStatus error:', error);
    return res.status(500).json({ error: 'Failed to read backup status', detail: error.message });
  }
}

// POST /api/admin/backup/run - trigger an immediate backup to Google Drive.
export async function triggerBackup(req, res) {
  if (!isBackupConfigured()) {
    return res.status(400).json({
      error: 'Backup is not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON and GDRIVE_BACKUP_FOLDER_ID.',
    });
  }
  try {
    const result = await runBackup({ trigger: 'manual' });
    return res.json({ message: 'Backup completed', result });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// GET /api/admin/backup/download - stream a fresh full-database dump to the
// browser as a .sql.gz file. Works even when Google Drive is not configured,
// so an admin can always keep a local copy of ALL data + settings.
export async function downloadBackup(req, res) {
  let localPath = null;
  try {
    const dump = await createDumpFile();
    localPath = dump.localPath;
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${dump.fileName}"`);
    res.setHeader('Content-Length', String(dump.sizeBytes));
    const stream = createReadStream(localPath);
    stream.on('error', () => { if (!res.headersSent) res.status(500).end(); });
    stream.on('close', () => { fsp.unlink(localPath).catch(() => {}); });
    stream.pipe(res);
  } catch (error) {
    console.error('downloadBackup error:', error);
    if (localPath) fsp.unlink(localPath).catch(() => {});
    if (!res.headersSent) return res.status(500).json({ error: 'Failed to create backup', detail: error.message });
  }
}

// POST /api/admin/backup/restore - restore the whole database from an uploaded
// dump file (raw body, .sql or .sql.gz). DESTRUCTIVE: replaces all current data.
export async function restoreBackup(req, res) {
  const body = req.body;
  if (!body || !Buffer.isBuffer(body) || body.length === 0) {
    return res.status(400).json({ error: 'No backup file received. Upload a .sql or .sql.gz dump as the request body.' });
  }
  // gzip magic bytes 0x1f 0x8b -> treat as .gz; otherwise plain SQL.
  const isGz = body.length > 2 && body[0] === 0x1f && body[1] === 0x8b;
  const localPath = path.join(tmpdir(), `orbit-restore-${Date.now()}.sql${isGz ? '.gz' : ''}`);
  try {
    await fsp.writeFile(localPath, body);
    await restoreDatabase(localPath);
    return res.json({ message: 'Database restored successfully.', sizeBytes: body.length });
  } catch (error) {
    console.error('restoreBackup error:', error);
    return res.status(500).json({ error: 'Restore failed', detail: error.message });
  } finally {
    fsp.unlink(localPath).catch(() => {});
  }
}

// POST /api/admin/backup/restore-drive { fileId } - restore from one of the
// backups already stored in the Google Drive folder. DESTRUCTIVE.
export async function restoreFromDrive(req, res) {
  const { fileId } = req.body || {};
  if (!fileId) return res.status(400).json({ error: 'fileId is required' });
  if (!isBackupConfigured()) {
    return res.status(400).json({ error: 'Google Drive backup is not configured.' });
  }
  let localPath = null;
  try {
    const token = await getDriveAccessToken();
    localPath = await downloadDriveFile(fileId, token);
    await restoreDatabase(localPath);
    return res.json({ message: 'Database restored from Google Drive backup.' });
  } catch (error) {
    console.error('restoreFromDrive error:', error);
    return res.status(500).json({ error: 'Restore failed', detail: error.message });
  } finally {
    if (localPath) fsp.unlink(localPath).catch(() => {});
  }
}
