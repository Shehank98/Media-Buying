import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  getScheduleLogs,
  getMetadata,
  getAnalytics,
  createScheduleLog,
  bulkCreateScheduleLogs,
  updateScheduleLog,
  deleteScheduleLog,
  getScheduleLogEdits,
  getUploadBatches,
  getRecentBatches,
  deleteUploadBatch,
} from '../controllers/database.controller.js';

const router = Router();

router.get('/', authenticate, getScheduleLogs);
router.get('/metadata', authenticate, getMetadata);
router.get('/analytics', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), getAnalytics);
router.get('/batches', authenticate, getUploadBatches);
router.get('/recent-batches', authenticate, getRecentBatches);
router.post('/', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'PLANNER'), createScheduleLog);
router.post('/bulk', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'PLANNER'), bulkCreateScheduleLogs);
router.put('/:id', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'PLANNER'), updateScheduleLog);
router.delete('/batches/:batchId', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'PLANNER'), deleteUploadBatch);
router.delete('/:id', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'PLANNER'), deleteScheduleLog);
router.get('/:id/edits', authenticate, getScheduleLogEdits);

export default router;
