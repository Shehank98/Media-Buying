import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { checkClientAccess } from '../middleware/access.js';
import {
  listScheduleLogs,
  createScheduleLog,
  updateScheduleLog,
  deleteScheduleLog,
} from '../controllers/schedulelog.controller.js';

const router = Router();

// List schedule logs for a client (all authenticated roles can read)
router.get(
  '/client/:clientId',
  authenticate,
  checkClientAccess,
  listScheduleLogs
);

// Create schedule log (SUPER_ADMIN, GROUP_HEAD, PLANNER only)
router.post(
  '/client/:clientId',
  authenticate,
  requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'PLANNER'),
  checkClientAccess,
  createScheduleLog
);

// Update schedule log
router.put(
  '/:id',
  authenticate,
  requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'PLANNER'),
  updateScheduleLog
);

// Delete schedule log (SUPER_ADMIN and GROUP_HEAD only)
router.delete(
  '/:id',
  authenticate,
  requireRole('SUPER_ADMIN', 'GROUP_HEAD'),
  deleteScheduleLog
);

export default router;
