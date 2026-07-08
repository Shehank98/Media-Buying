import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  listAgencies,
  createAgency,
  updateAgency,
  deleteAgency,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  assignAgencies,
  assignClients,
  listTeams,
  createTeam,
  updateTeam,
  deleteTeam,
  assignTeamMembers,
  assignTeamClients,
  listChannelMasters,
  createChannelMaster,
  updateChannelMaster,
  deleteChannelMaster,
  listAnnualTargets,
  upsertAnnualTarget,
  deleteAnnualTarget,
  listAdminClients,
  toggleClientActive,
  setClientCommission,
  moveClientAgency,
  mergeClients,
  listClientRequests,
  reviewClientRequest,
  listChannelRequests,
  reviewChannelRequest,
  listGroupRevenue,
  setGroupRevenue,
} from '../controllers/admin.controller.js';

const router = Router();

router.use(authenticate, requireRole('SUPER_ADMIN'));

// Agencies
router.get('/agencies', listAgencies);
router.post('/agencies', createAgency);
router.put('/agencies/:id', updateAgency);
router.delete('/agencies/:id', deleteAgency);

// Users
router.get('/users', listUsers);
router.post('/users', createUser);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);
router.post('/users/:id/agencies', assignAgencies);
router.post('/users/:id/clients', assignClients);

// Teams
router.get('/teams', listTeams);
router.post('/teams', createTeam);
router.put('/teams/:id', updateTeam);
router.delete('/teams/:id', deleteTeam);
router.post('/teams/:id/members', assignTeamMembers);
router.post('/teams/:id/clients', assignTeamClients);

// Clients (active/hide for forecasting visibility)
router.get('/clients', listAdminClients);
router.put('/clients/:id/toggle', toggleClientActive);
router.put('/clients/:id/commission', setClientCommission);
router.post('/clients/:id/move-agency', moveClientAgency);
router.post('/clients/merge', mergeClients);

// Forecasting requests
router.get('/client-requests', listClientRequests);
router.put('/client-requests/:id', reviewClientRequest);
router.get('/channel-requests', listChannelRequests);
router.put('/channel-requests/:id', reviewChannelRequest);

// Annual Targets (forecasting)
router.get('/annual-targets', listAnnualTargets);
router.post('/annual-targets', upsertAnnualTarget);
router.delete('/annual-targets/:id', deleteAnnualTarget);

// Channel Masters
router.get('/channel-masters', listChannelMasters);
router.post('/channel-masters', createChannelMaster);
router.put('/channel-masters/:id', updateChannelMaster);
router.delete('/channel-masters/:id', deleteChannelMaster);

// Group Revenue Contribution (per group head, per month) → Executive Dashboard right donut
router.get('/group-revenue', listGroupRevenue);
router.post('/group-revenue', setGroupRevenue);

export default router;
