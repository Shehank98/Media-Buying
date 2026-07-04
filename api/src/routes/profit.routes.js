import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  getProfitSummary,
  getProfitMonthly,
  getProfitByAgency,
  getProfitByClient,
  getProfitDetails,
} from '../controllers/profit.controller.js';

const router = Router();

// Financial reporting — SUPER_ADMIN only, enforced server-side (not just hidden
// in the UI). Every route returns 403 for any other role.
router.use(authenticate, requireRole('SUPER_ADMIN'));

router.get('/summary', getProfitSummary);
router.get('/monthly', getProfitMonthly);
router.get('/by-agency', getProfitByAgency);
router.get('/by-client', getProfitByClient);
router.get('/details', getProfitDetails);

export default router;
