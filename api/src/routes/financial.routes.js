import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { financialAuthenticate, requireFinancialRole, blockReadOnly } from '../middleware/financialAuth.js';
import { financialLogin, financialMe } from '../controllers/financialAuth.controller.js';
import { listSchedules, updatePayment, dashboardSummary, meta } from '../controllers/financial.controller.js';

// Isolated API for the external financial payment tracker. Everything lives
// under /api/financial — no existing route, controller or table is touched.
// Disable the whole surface with FINANCIAL_API_ENABLED=false.
const router = Router();

const limiter = (max) => rateLimit({
  windowMs: 15 * 60 * 1000,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' },
});

router.post('/auth/login', limiter(30), financialLogin);

// Everything below requires a financial bearer token AND one of the three
// mapped roles (hub / boardroom / control_room). PLANNER never gets a token.
router.use(financialAuthenticate, requireFinancialRole());

router.get('/auth/me', financialMe);
router.get('/meta', meta);
router.get('/schedules', listSchedules);
router.patch('/schedules/:id/payment', blockReadOnly, updatePayment);
router.get('/dashboard/summary', dashboardSummary);

export default router;
