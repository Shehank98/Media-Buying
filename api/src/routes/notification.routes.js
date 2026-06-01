import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  getUploadTracker,
  sendReminder,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  exportMasterSheet,
} from '../controllers/uploadtracker.controller.js';

const router = Router();

// Upload tracker (admin only)
router.get('/upload-tracker', authenticate, requireRole('SUPER_ADMIN'), getUploadTracker);
router.post('/send-reminder', authenticate, requireRole('SUPER_ADMIN'), sendReminder);
router.get('/master-sheet', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), exportMasterSheet);

// Notifications (all authenticated users)
router.get('/', authenticate, getNotifications);
router.patch('/:id/read', authenticate, markNotificationRead);
router.patch('/read-all', authenticate, markAllNotificationsRead);

export default router;
