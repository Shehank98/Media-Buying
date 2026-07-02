import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  getNextMonth,
  getVariance,
  exportForecastEntries,
  listForecastClients,
  listForecastChannels,
  getForecastEntry,
  getPreviousForecast,
  submitForecast,
  forecastHistory,
  requestClient,
  requestChannel,
} from '../controllers/forecasting.controller.js';

const router = Router();

router.get('/next-month', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD'), getNextMonth);
router.get('/clients', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD'), listForecastClients);
router.get('/export-entries', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD'), exportForecastEntries);
router.get('/channels', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD'), listForecastChannels);
router.get('/entry', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD'), getForecastEntry);
router.get('/previous', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD'), getPreviousForecast);
router.post('/submit', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD'), submitForecast);
router.get('/history', authenticate, requireRole('SUPER_ADMIN'), forecastHistory);
router.get('/variance', authenticate, requireRole('SUPER_ADMIN'), getVariance);
router.post('/request-client', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD'), requestClient);
router.post('/request-channel', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD'), requestChannel);

export default router;
