import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  listPackages,
  getPackage,
  createPackage,
  updatePackage,
  togglePackage,
  deletePackage,
  listGroupHeads,
  sendPackage,
  getPackageResponses,
  updateFollowUp,
  getPackageByToken,
  submitPackageResponse,
} from '../controllers/package.controller.js';

const router = Router();

// Public, token-authenticated (no JWT) — declare before any '/:id' routes.
router.get('/public/by-token', getPackageByToken);
router.post('/public/submit', submitPackageResponse);

// Admin (SUPER_ADMIN) — literal segments before '/:id'.
router.get('/recipients/group-heads', authenticate, requireRole('SUPER_ADMIN'), listGroupHeads);
router.patch('/recipients/:recipientId/follow-up', authenticate, requireRole('SUPER_ADMIN'), updateFollowUp);

router.get('/', authenticate, requireRole('SUPER_ADMIN'), listPackages);
router.post('/', authenticate, requireRole('SUPER_ADMIN'), createPackage);
router.get('/:id', authenticate, requireRole('SUPER_ADMIN'), getPackage);
router.put('/:id', authenticate, requireRole('SUPER_ADMIN'), updatePackage);
router.patch('/:id/toggle', authenticate, requireRole('SUPER_ADMIN'), togglePackage);
router.delete('/:id', authenticate, requireRole('SUPER_ADMIN'), deletePackage);
router.post('/:id/send', authenticate, requireRole('SUPER_ADMIN'), sendPackage);
router.get('/:id/responses', authenticate, requireRole('SUPER_ADMIN'), getPackageResponses);

export default router;
