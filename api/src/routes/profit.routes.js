import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  getProfitSummary,
  getProfitMonthly,
  getProfitByAgency,
  getProfitByClient,
  getProfitByCommissionType,
  getProfitClientBreakdown,
  getProfitDetails,
} from '../controllers/profit.controller.js';
import {
  getBillingSummary,
  getBillingMonthly,
  getBillingByAgency,
  getBillingByClient,
  getBillingClientBreakdown,
  getAorMonthly,
} from '../controllers/billing.controller.js';

const router = Router();

// Financial reporting - SUPER_ADMIN only, enforced server-side (not just hidden
// in the UI). Every route returns 403 for any other role.
router.use(authenticate, requireRole('SUPER_ADMIN'));

// Revenue by schedule value (profit) — the original tab.
router.get('/summary', getProfitSummary);
router.get('/monthly', getProfitMonthly);
router.get('/by-agency', getProfitByAgency);
router.get('/by-client', getProfitByClient);
router.get('/by-commission-type', getProfitByCommissionType);
router.get('/client-breakdown', getProfitClientBreakdown);
router.get('/details', getProfitDetails);

// Revenue by billing — sourced from admin-entered ClientRevenue.amount.
router.get('/billing/summary', getBillingSummary);
router.get('/billing/monthly', getBillingMonthly);
router.get('/billing/by-agency', getBillingByAgency);
router.get('/billing/by-client', getBillingByClient);
router.get('/billing/client-breakdown', getBillingClientBreakdown);
router.get('/billing/aor-monthly', getAorMonthly);

export default router;
