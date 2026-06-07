import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { checkChannelAccess } from '../middleware/access.js';
import { getChannel, getProperties, createProperty } from '../controllers/channel.controller.js';

const router = Router();

router.get('/:channelId', authenticate, checkChannelAccess, getChannel);
router.get('/:channelId/properties', authenticate, checkChannelAccess, getProperties);
router.post('/:channelId/properties', authenticate, requireRole('PLANNER', 'GROUP_HEAD', 'SUPER_ADMIN'), checkChannelAccess, createProperty);

export default router;
