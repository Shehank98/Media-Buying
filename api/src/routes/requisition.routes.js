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
// MANAGER (Boardroom) is included so an admin can grant the Buying Requisition
// page to a manager via per-user page access and have it actually work.
router.get('/clients', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'PLANNER', 'MANAGER'), listRequisitionClients);
router.get('/', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'PLANNER', 'MANAGER'), listRequisitions);
router.get('/:id', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'PLANNER', 'MANAGER'), getRequisition);
router.post('/', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'PLANNER', 'MANAGER'), createRequisition);
router.delete('/:id', authenticate, requireRole('SUPER_ADMIN'), deleteRequisition);

export default router;
