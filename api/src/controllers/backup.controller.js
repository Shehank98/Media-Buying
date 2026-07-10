import { runBackup, getBackupStatus, listBackups, isBackupConfigured } from '../services/backup.service.js';

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

// POST /api/admin/backup/run - trigger an immediate backup.
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
