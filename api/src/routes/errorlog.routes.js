import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { reportClientError } from '../controllers/errorlog.controller.js';

const router = Router();

// Public crash reporter - no auth (works on login/public pages), rate-limited
// per IP so a misbehaving client can't flood the error table.
const reportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many error reports.' },
});

router.post('/client', reportLimiter, reportClientError);

export default router;
