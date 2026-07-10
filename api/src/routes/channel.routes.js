import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { checkChannelAccess, checkChannelClientDealAccess } from '../middleware/access.js';
import {
  getChannel, getProperties, createProperty,
  listChannelDeals, upsertChannelDeal, updateChannelDeal, deleteChannelDeal,
  uploadClientRateCard, getClientRateCard, deleteClientRateCard, listGeneralRateCards,
} from '../controllers/channel.controller.js';

const router = Router();

// General rate cards directory (all channels' general cards) - search + download.
// Open to every authenticated role. Precedes '/:channelId' so it isn't captured as an id.
router.get('/rate-cards/general', authenticate, listGeneralRateCards);

router.get('/:channelId', authenticate, checkChannelAccess, getChannel);
router.get('/:channelId/properties', authenticate, checkChannelAccess, getProperties);
router.post('/:channelId/properties', authenticate, requireRole('PLANNER', 'GROUP_HEAD', 'SUPER_ADMIN'), checkChannelAccess, createProperty);

// Client-specific rate card: SUPER_ADMIN uploads/deletes; anyone with channel access downloads.
router.get('/:channelId/rate-card', authenticate, checkChannelAccess, getClientRateCard);
router.post('/:channelId/rate-card', authenticate, requireRole('SUPER_ADMIN'), checkChannelAccess, uploadClientRateCard);
router.delete('/:channelId/rate-card', authenticate, requireRole('SUPER_ADMIN'), checkChannelAccess, deleteClientRateCard);

router.get('/:channelId/deals', authenticate, checkChannelAccess, listChannelDeals);
router.post('/:channelId/deals', authenticate, requireRole('PLANNER', 'GROUP_HEAD', 'SUPER_ADMIN'), checkChannelAccess, upsertChannelDeal);
router.put('/deals/:id', authenticate, requireRole('PLANNER', 'GROUP_HEAD', 'SUPER_ADMIN'), checkChannelClientDealAccess, updateChannelDeal);
router.delete('/deals/:id', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD'), checkChannelClientDealAccess, deleteChannelDeal);

export default router;
