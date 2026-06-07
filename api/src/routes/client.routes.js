import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { checkClientAccess } from '../middleware/access.js';
import {
  getClient,
  updateClient,
  deleteClient,
  getChannels,
  createChannel,
  updateChannel,
  deleteChannel,
} from '../controllers/client.controller.js';

const router = Router();

router.get('/:clientId', authenticate, checkClientAccess, getClient);
router.put('/:clientId', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD'), checkClientAccess, updateClient);
router.delete('/:clientId', authenticate, requireRole('SUPER_ADMIN'), checkClientAccess, deleteClient);
router.get('/:clientId/channels', authenticate, checkClientAccess, getChannels);
router.post('/:clientId/channels', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'PLANNER'), checkClientAccess, createChannel);
router.put('/channels/:id', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD'), updateChannel);
router.delete('/channels/:id', authenticate, requireRole('SUPER_ADMIN'), deleteChannel);

export default router;
