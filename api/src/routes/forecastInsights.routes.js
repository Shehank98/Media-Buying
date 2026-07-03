import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  getInsightsSummary,
  getInsightsVariance,
  getInsightsAccuracy,
  getInsightsTrend,
  getInsightsBudget,
} from '../controllers/forecastInsights.controller.js';

const router = Router();

router.get('/insights/summary', authenticate, requireRole('SUPER_ADMIN'), getInsightsSummary);
router.get('/insights/variance', authenticate, requireRole('SUPER_ADMIN'), getInsightsVariance);
router.get('/insights/accuracy', authenticate, requireRole('SUPER_ADMIN'), getInsightsAccuracy);
router.get('/insights/trend', authenticate, requireRole('SUPER_ADMIN'), getInsightsTrend);
router.get('/insights/budget', authenticate, requireRole('SUPER_ADMIN'), getInsightsBudget);

export default router;
