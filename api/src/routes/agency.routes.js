import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { checkAgencyAccess } from '../middleware/access.js';
import { list, getClients } from '../controllers/agency.controller.js';

const router = Router();

router.get('/', authenticate, list);
router.get('/:agencyId/clients', authenticate, checkAgencyAccess, getClients);

export default router;
