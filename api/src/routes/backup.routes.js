import { Router } from 'express';
import express from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  backupStatus, triggerBackup, downloadBackup, restoreBackup, restoreFromDrive,
  dataExportStatus, triggerDataExport,
} from '../controllers/backup.controller.js';

const router = Router();

// Database backup / restore (SUPER_ADMIN only).
router.get('/status', authenticate, requireRole('SUPER_ADMIN'), backupStatus);
router.post('/run', authenticate, requireRole('SUPER_ADMIN'), triggerBackup);
// On-demand full-database dump download (all data + settings), Drive-independent.
router.get('/download', authenticate, requireRole('SUPER_ADMIN'), downloadBackup);
// Restore from an uploaded dump file - raw binary body (.sql or .sql.gz).
router.post(
  '/restore',
  authenticate,
  requireRole('SUPER_ADMIN'),
  express.raw({ type: '*/*', limit: '512mb' }),
  restoreBackup,
);
// Restore from a backup already in the Google Drive folder.
router.post('/restore-drive', authenticate, requireRole('SUPER_ADMIN'), restoreFromDrive);

// Daily per-tab Excel export to Google Drive (revenue / master data / targets).
router.get('/data-export/status', authenticate, requireRole('SUPER_ADMIN'), dataExportStatus);
router.post('/data-export/run', authenticate, requireRole('SUPER_ADMIN'), triggerDataExport);

export default router;
