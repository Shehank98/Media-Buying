import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { byChannel, byClient, byAgency } from '../controllers/report.controller.js';

const router = Router();

router.use(authenticate, requireRole('SUPER_ADMIN', 'MANAGER'));

router.get('/channel/:channelId', byChannel);
router.get('/client/:clientId', byClient);
router.get('/agency/:agencyId', byAgency);

export default router;
