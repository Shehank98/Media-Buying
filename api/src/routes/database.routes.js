import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  getScheduleLogs,
  createScheduleLog,
  updateScheduleLog,
  deleteScheduleLog,
  getScheduleLogEdits,
} from '../controllers/database.controller.js';

const router = Router();

router.get('/', authenticate, getScheduleLogs);
router.post('/', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'PLANNER'), createScheduleLog);
router.put('/:id', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'PLANNER'), updateScheduleLog);
router.delete('/:id', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'PLANNER'), deleteScheduleLog);
router.get('/:id/edits', authenticate, getScheduleLogEdits);

export default router;
