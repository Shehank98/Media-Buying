import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { getChannel, getProperties, createProperty } from '../controllers/channel.controller.js';

const router = Router();

router.get('/:channelId', authenticate, getChannel);
router.get('/:channelId/properties', authenticate, getProperties);
router.post('/:channelId/properties', authenticate, requireRole('PLANNER', 'GROUP_HEAD', 'SUPER_ADMIN'), createProperty);

export default router;
