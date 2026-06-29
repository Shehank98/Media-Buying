import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { checkChannelAccess, checkChannelClientDealAccess } from '../middleware/access.js';
import {
  getChannel, getProperties, createProperty,
  listChannelDeals, upsertChannelDeal, updateChannelDeal, deleteChannelDeal,
} from '../controllers/channel.controller.js';

const router = Router();

router.get('/:channelId', authenticate, checkChannelAccess, getChannel);
router.get('/:channelId/properties', authenticate, checkChannelAccess, getProperties);
router.post('/:channelId/properties', authenticate, requireRole('PLANNER', 'GROUP_HEAD', 'SUPER_ADMIN'), checkChannelAccess, createProperty);

router.get('/:channelId/deals', authenticate, checkChannelAccess, listChannelDeals);
router.post('/:channelId/deals', authenticate, requireRole('PLANNER', 'GROUP_HEAD', 'SUPER_ADMIN'), checkChannelAccess, upsertChannelDeal);
router.put('/deals/:id', authenticate, requireRole('PLANNER', 'GROUP_HEAD', 'SUPER_ADMIN'), checkChannelClientDealAccess, updateChannelDeal);
router.delete('/deals/:id', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD'), checkChannelClientDealAccess, deleteChannelDeal);

export default router;
