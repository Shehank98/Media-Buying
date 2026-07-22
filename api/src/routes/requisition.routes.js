import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  listRequisitions,
  getRequisition,
  createRequisition,
  deleteRequisition,
  listRequisitionClients,
} from '../controllers/requisition.controller.js';

const router = Router();

// Desk (PLANNER) + Hub (GROUP_HEAD) raise/list their own; SUPER_ADMIN sees all.
router.get('/clients', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'PLANNER'), listRequisitionClients);
router.get('/', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'PLANNER'), listRequisitions);
router.get('/:id', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'PLANNER'), getRequisition);
router.post('/', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'PLANNER'), createRequisition);
router.delete('/:id', authenticate, requireRole('SUPER_ADMIN'), deleteRequisition);

export default router;
