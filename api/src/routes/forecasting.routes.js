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
  listBudget,
  submitBudget,
} from '../controllers/forecasting.controller.js';

const router = Router();

router.get('/next-month', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD'), getNextMonth);
// MANAGER (Boardroom) has read-only visibility of their agency's forecasts, so
// the GET/view endpoints allow MANAGER; writes (submit/request/export) do not.
router.get('/clients', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'MANAGER'), listForecastClients);
router.get('/export-entries', authenticate, requireRole('SUPER_ADMIN'), exportForecastEntries);
router.get('/channels', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'MANAGER'), listForecastChannels);
router.get('/entry', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'MANAGER'), getForecastEntry);
router.get('/previous', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'MANAGER'), getPreviousForecast);
router.post('/submit', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD'), submitForecast);
router.get('/history', authenticate, requireRole('SUPER_ADMIN'), forecastHistory);
router.get('/variance', authenticate, requireRole('SUPER_ADMIN'), getVariance);
router.post('/request-client', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD'), requestClient);
router.post('/request-channel', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD'), requestChannel);

// Overall Budget worksheet (Actual auto from forecast, Best + Billing entered)
router.get('/budget', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'MANAGER'), listBudget);
router.post('/budget', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD'), submitBudget);

export default router;
