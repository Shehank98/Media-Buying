import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  getScheduleLogs,
  getMetadata,
  getAnalytics,
  getScopedProperties,
  createScheduleLog,
  bulkCreateScheduleLogs,
  importAllScheduleLogs,
  reconcileImport,
  applyImportReconciliation,
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
router.get('/analytics', authenticate, requireRole('SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD', 'PLANNER'), getAnalytics);
router.get('/properties', authenticate, requireRole('SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD', 'PLANNER'), getScopedProperties);
router.get('/batches', authenticate, getUploadBatches);
router.get('/recent-batches', authenticate, getRecentBatches);
router.post('/', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'PLANNER'), createScheduleLog);
router.post('/bulk', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'PLANNER'), bulkCreateScheduleLogs);
router.post('/import-all', authenticate, requireRole('SUPER_ADMIN'), importAllScheduleLogs);
router.post('/import-reconcile', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'PLANNER'), reconcileImport);
router.post('/import-apply', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'PLANNER'), applyImportReconciliation);
router.put('/:id', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'PLANNER'), updateScheduleLog);
router.delete('/batches/:batchId', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'PLANNER'), deleteUploadBatch);
router.delete('/:id', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'PLANNER'), deleteScheduleLog);
router.get('/:id/edits', authenticate, getScheduleLogEdits);

export default router;
