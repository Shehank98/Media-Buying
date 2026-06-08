import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  getInsights,
  getAlerts,
  getForecast,
  getChannelScores,
} from '../controllers/decisions.controller.js';

const router = Router();

// Decision Support — restricted to roles with cross-portfolio visibility.
router.get('/insights', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), getInsights);
router.get('/alerts', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), getAlerts);
router.get('/forecast', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), getForecast);
router.get('/channel-scores', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), getChannelScores);

export default router;
