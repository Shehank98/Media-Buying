import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  getChannelIntelligence,
  getClientChannelYearly,
  upsertAgencyDeal,
  deleteAgencyDeal,
  upsertClientDeal,
  deleteClientDeal,
  getNegotiationPlanner,
} from '../controllers/mediabuying.controller.js';

const router = Router();

router.use(authenticate, requireRole('SUPER_ADMIN'));

router.get('/channels/:channelMasterId', getChannelIntelligence);
router.get('/channels/:channelMasterId/clients/:clientId/yearly', getClientChannelYearly);
router.get('/channels/:channelMasterId/planner', getNegotiationPlanner);
router.post('/agency-deals', upsertAgencyDeal);
router.delete('/agency-deals/:id', deleteAgencyDeal);
router.post('/client-deals', upsertClientDeal);
router.delete('/client-deals/:id', deleteClientDeal);

export default router;
