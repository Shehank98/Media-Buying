import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  listMediaGroups,
  createMediaGroup,
  updateMediaGroup,
  toggleMediaGroup,
  deleteMediaGroup,
  listChannelMasters,
  createChannelMaster,
  updateChannelMaster,
  toggleChannelMaster,
  deleteChannelMaster,
  mergeChannelMasters,
  listAllBrands,
  createBrand,
  toggleBrand,
  listAllCampaigns,
  createCampaign,
  toggleCampaign,
  listPropertyCategories,
  createPropertyCategory,
  updatePropertyCategory,
  togglePropertyCategory,
} from '../controllers/masterdata.controller.js';

const router = Router();

// Media Groups
router.get('/media-groups', authenticate, requireRole('SUPER_ADMIN'), listMediaGroups);
router.post('/media-groups', authenticate, requireRole('SUPER_ADMIN'), createMediaGroup);
router.put('/media-groups/:id', authenticate, requireRole('SUPER_ADMIN'), updateMediaGroup);
router.patch('/media-groups/:id/toggle', authenticate, requireRole('SUPER_ADMIN'), toggleMediaGroup);
router.delete('/media-groups/:id', authenticate, requireRole('SUPER_ADMIN'), deleteMediaGroup);

// Channel Masters
router.get('/channel-masters', authenticate, listChannelMasters);
router.post('/channel-masters', authenticate, requireRole('SUPER_ADMIN'), createChannelMaster);
router.put('/channel-masters/:id', authenticate, requireRole('SUPER_ADMIN'), updateChannelMaster);
router.patch('/channel-masters/:id/toggle', authenticate, requireRole('SUPER_ADMIN'), toggleChannelMaster);
router.delete('/channel-masters/:id', authenticate, requireRole('SUPER_ADMIN'), deleteChannelMaster);
router.post('/channel-masters/merge', authenticate, requireRole('SUPER_ADMIN'), mergeChannelMasters);

// Brands
router.get('/brands', authenticate, requireRole('SUPER_ADMIN'), listAllBrands);
router.post('/brands', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'PLANNER'), createBrand);
router.patch('/brands/:id/toggle', authenticate, requireRole('SUPER_ADMIN'), toggleBrand);

// Campaigns
router.get('/campaigns', authenticate, requireRole('SUPER_ADMIN'), listAllCampaigns);
router.post('/campaigns', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD', 'PLANNER'), createCampaign);
router.patch('/campaigns/:id/toggle', authenticate, requireRole('SUPER_ADMIN'), toggleCampaign);

// Property Categories (list readable by anyone who can add properties; mutations admin-only)
router.get('/property-categories', authenticate, listPropertyCategories);
router.post('/property-categories', authenticate, requireRole('SUPER_ADMIN'), createPropertyCategory);
router.put('/property-categories/:id', authenticate, requireRole('SUPER_ADMIN'), updatePropertyCategory);
router.patch('/property-categories/:id/toggle', authenticate, requireRole('SUPER_ADMIN'), togglePropertyCategory);

export default router;
