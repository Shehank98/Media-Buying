import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { checkAgencyAccess } from '../middleware/access.js';
import { list, getOne, getClients, createClient } from '../controllers/agency.controller.js';
import { getAgencyGroups } from '../controllers/clientgroup.controller.js';

const router = Router();

router.get('/', authenticate, list);
router.get('/:agencyId', authenticate, checkAgencyAccess, getOne);
router.get('/:agencyId/clients', authenticate, checkAgencyAccess, getClients);
router.get('/:agencyId/groups', authenticate, checkAgencyAccess, getAgencyGroups);
router.post('/:agencyId/clients', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD'), checkAgencyAccess, createClient);

export default router;
