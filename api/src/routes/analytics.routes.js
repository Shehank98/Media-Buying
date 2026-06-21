import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { checkClientAccess } from '../middleware/access.js';
import {
  getChannelSummary,
  getChannelMonthlySpend,
  getChannelAgencyMonthly,
  getChannelClients,
  getChannelPropertyHistory,
  getClientOverview,
  getDashboardSummary,
  getAgencyComparison,
  getTopClients,
  getTopChannels,
  getMediumSplit,
  getMonthlyTrend,
  getActivityLog,
  getRecentUploads,
  getDeepDashboard,
} from '../controllers/analytics.controller.js';

const router = Router();

// Channel Intelligence
router.get('/channel/:channelMasterId/summary', authenticate, requireRole('SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD'), getChannelSummary);
router.get('/channel/:channelMasterId/monthly-spend', authenticate, requireRole('SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD'), getChannelMonthlySpend);
router.get('/channel/:channelMasterId/agency-monthly', authenticate, requireRole('SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD'), getChannelAgencyMonthly);
router.get('/channel/:channelMasterId/clients', authenticate, requireRole('SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD'), getChannelClients);
router.get('/channel/:channelMasterId/property-history', authenticate, requireRole('SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD'), getChannelPropertyHistory);

// Client dashboard / overview
router.get('/client/:clientId/overview', authenticate, requireRole('SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD'), checkClientAccess, getClientOverview);

// Executive Dashboard
router.get('/dashboard/summary', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), getDashboardSummary);
router.get('/dashboard/agency-comparison', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), getAgencyComparison);
router.get('/dashboard/top-clients', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), getTopClients);
router.get('/dashboard/top-channels', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), getTopChannels);
router.get('/dashboard/medium-split', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), getMediumSplit);
router.get('/dashboard/monthly-trend', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), getMonthlyTrend);
router.get('/dashboard/activity-log', authenticate, requireRole('SUPER_ADMIN'), getActivityLog);
router.get('/dashboard/recent-uploads', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), getRecentUploads);
router.get('/deep-dashboard', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), getDeepDashboard);

export default router;
