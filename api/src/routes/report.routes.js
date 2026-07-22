import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { byChannel, byClient, byAgency, exportScheduleLogs, exportProperties, mediaGroupReport } from '../controllers/report.controller.js';

const router = Router();

// Reports are readable by admins, managers, and any scoped user who has been
// granted the Reports page (GROUP_HEAD / PLANNER). Every controller below
// enforces accessibleClientScope, so a scoped user only ever sees their own
// clients' data; SUPER_ADMIN is unrestricted.
router.use(authenticate, requireRole('SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD', 'PLANNER'));

router.get('/properties', exportProperties);
router.get('/schedule-logs', exportScheduleLogs);
router.get('/media-group', mediaGroupReport);
router.get('/channel/:channelId', byChannel);
router.get('/client/:clientId', byClient);
router.get('/agency/:agencyId', byAgency);

export default router;
