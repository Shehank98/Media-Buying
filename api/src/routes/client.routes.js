import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { checkClientAccess } from '../middleware/access.js';
import {
  getClient,
  getChannels,
  createChannel,
  updateChannel,
  deleteChannel,
} from '../controllers/client.controller.js';

const router = Router();

router.get('/:clientId', authenticate, checkClientAccess, getClient);
router.get('/:clientId/channels', authenticate, checkClientAccess, getChannels);
router.post('/:clientId/channels', authenticate, checkClientAccess, createChannel);
router.put('/channels/:id', authenticate, updateChannel);
router.delete('/channels/:id', authenticate, deleteChannel);

export default router;
