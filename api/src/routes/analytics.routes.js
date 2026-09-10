import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { checkClientAccess } from '../middleware/access.js';
import { getCommitmentPlanner } from '../controllers/commitment.controller.js';
import {
  getChannelSummary,
  getChannelRateCard,
  getChannelMonthlySpend,
  getChannelMonthDetail,
  getChannelAgencyMonthly,
  getChannelClients,
  getChannelPropertyHistory,
  getClientOverview,
  getDashboardSummary,
  getAgencyComparison,
  getAgencyRevenue,
  getTopClients,
  getTopChannels,
  getMediumSplit,
  getMonthlyTrend,
  getActivityLog,
  getRecentUploads,
  getDeepDashboard,
  getAchievement,
  getChannelCommitments,
  getChannelForecastVsTarget,
  getRevenueAchievement,
  getAgencyAchievement,
  getForecastMonthly,
  getGroupContribution,
  getGroupContributionVariance,
  getMonthlyAvgByYear,
} from '../controllers/analytics.controller.js';
import { getClientGroupOverview } from '../controllers/clientgroup.controller.js';

const router = Router();

// Channel Intelligence
router.get('/channel/:channelMasterId/summary', authenticate, requireRole('SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD', 'PLANNER'), getChannelSummary);
router.get('/channel/:channelMasterId/rate-card', authenticate, requireRole('SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD', 'PLANNER'), getChannelRateCard);
router.get('/channel/:channelMasterId/monthly-spend', authenticate, requireRole('SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD', 'PLANNER'), getChannelMonthlySpend);
router.get('/channel/:channelMasterId/month-detail', authenticate, requireRole('SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD', 'PLANNER'), getChannelMonthDetail);
router.get('/channel/:channelMasterId/agency-monthly', authenticate, requireRole('SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD', 'PLANNER'), getChannelAgencyMonthly);
router.get('/channel/:channelMasterId/clients', authenticate, requireRole('SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD', 'PLANNER'), getChannelClients);
router.get('/channel/:channelMasterId/property-history', authenticate, requireRole('SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD', 'PLANNER'), getChannelPropertyHistory);

// Client dashboard / overview
router.get('/client/:clientId/overview', authenticate, requireRole('SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD', 'PLANNER'), checkClientAccess, getClientOverview);
// Client-group (parent company) aggregated overview - access enforced inside.
router.get('/client-group/:groupId/overview', authenticate, requireRole('SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD', 'PLANNER'), getClientGroupOverview);

// Executive Dashboard
router.get('/dashboard/summary', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), getDashboardSummary);
router.get('/dashboard/agency-comparison', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), getAgencyComparison);
router.get('/dashboard/agency-revenue', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), getAgencyRevenue);
router.get('/dashboard/top-clients', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), getTopClients);
router.get('/dashboard/top-channels', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), getTopChannels);
router.get('/dashboard/medium-split', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), getMediumSplit);
router.get('/dashboard/monthly-trend', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), getMonthlyTrend);
router.get('/dashboard/activity-log', authenticate, requireRole('SUPER_ADMIN'), getActivityLog);
router.get('/dashboard/recent-uploads', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), getRecentUploads);
router.get('/deep-dashboard', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), getDeepDashboard);
// Commitment Planner (Deep Dashboard) - 90%-safe yearly commitment forecast
router.get('/commitment-planner', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), getCommitmentPlanner);

// Forecasting dashboard
router.get('/dashboard/achievement', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), getAchievement);
router.get('/dashboard/channel-commitments', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), getChannelCommitments);
router.get('/dashboard/channel-forecast-target', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), getChannelForecastVsTarget);
router.get('/dashboard/revenue-achievement', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), getRevenueAchievement);
router.get('/agency-achievement', authenticate, requireRole('SUPER_ADMIN', 'MANAGER', 'GROUP_HEAD'), getAgencyAchievement);
router.get('/dashboard/forecast-monthly', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), getForecastMonthly);
router.get('/dashboard/group-contribution', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), getGroupContribution);
router.get('/dashboard/group-contribution-variance', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), getGroupContributionVariance);
router.get('/dashboard/monthly-avg-by-year', authenticate, requireRole('SUPER_ADMIN', 'MANAGER'), getMonthlyAvgByYear);

export default router;
