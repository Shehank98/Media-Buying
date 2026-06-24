import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  getNextMonth,
  listForecastClients,
  listForecastChannels,
  getForecastEntry,
  submitForecast,
  forecastHistory,
  requestClient,
  requestChannel,
} from '../controllers/forecasting.controller.js';

const router = Router();

router.get('/next-month', authenticate, requireRole('SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD'), getNextMonth);
router.get('/clients', authenticate, requireRole('SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD'), listForecastClients);
router.get('/channels', authenticate, requireRole('SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD'), listForecastChannels);
router.get('/entry', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD'), getForecastEntry);
router.post('/submit', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD'), submitForecast);
router.get('/history', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), forecastHistory);
router.post('/request-client', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD'), requestClient);
router.post('/request-channel', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD'), requestChannel);

export default router;
