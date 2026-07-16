import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { listRevenueVerification, submitRevenueVerification, getPendingRevenueVerification } from '../controllers/revenueVerification.controller.js';

const router = Router();

// Rev Verification (Spend Analytics) — group heads verify their clients' finance
// revenue figure; SUPER_ADMIN can see/verify across all clients.
router.use(authenticate, requireRole('GROUP_HEAD', 'SUPER_ADMIN'));

router.get('/verification/pending', getPendingRevenueVerification);
router.get('/verification', listRevenueVerification);
router.post('/verification', submitRevenueVerification);

export default router;
