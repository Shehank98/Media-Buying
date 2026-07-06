import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { backupStatus, triggerBackup } from '../controllers/backup.controller.js';

const router = Router();

// Database backup to Google Drive (SUPER_ADMIN only).
router.get('/status', authenticate, requireRole('SUPER_ADMIN'), backupStatus);
router.post('/run', authenticate, requireRole('SUPER_ADMIN'), triggerBackup);

export default router;
