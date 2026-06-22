import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/auth.js';
import {
  login,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  changePassword,
  getProfile,
} from '../controllers/auth.controller.js';

const router = Router();

// Per-IP backstop against brute force / credential stuffing. Per-account
// lockout (in the login controller) handles targeted attacks; these limits are
// generous enough not to bother a busy office sharing one IP.
const limiter = (max) => rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' },
});

router.post('/login', limiter(30), login);
router.post('/refresh', limiter(120), refresh);
router.post('/logout', logout);
router.post('/forgot-password', limiter(10), forgotPassword);
router.post('/reset-password', limiter(20), resetPassword);
router.post('/change-password', authenticate, changePassword);
router.get('/profile', authenticate, getProfile);

export default router;
