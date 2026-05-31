import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { checkClientAccess } from '../middleware/access.js';
import {
  listBrands,
  createBrand,
  updateBrand,
  deleteBrand,
  listCampaigns,
  createCampaign,
  updateCampaign,
  deleteCampaign,
} from '../controllers/brand.controller.js';

const router = Router();

// Brand routes (nested under client)
router.get('/client/:clientId', authenticate, checkClientAccess, listBrands);
router.post('/client/:clientId', authenticate, checkClientAccess, createBrand);

// Brand CRUD (by brand id)
router.put('/:id', authenticate, updateBrand);
router.delete('/:id', authenticate, deleteBrand);

// Campaign routes (nested under brand)
router.get('/:brandId/campaigns', authenticate, listCampaigns);
router.post('/:brandId/campaigns', authenticate, createCampaign);

// Campaign CRUD (by campaign id) — note: mounted at /brands so use /campaigns prefix
// These need separate mounting; handled via the campaigns sub-path pattern
// The router at /api/brands handles /:brandId/campaigns
// Campaign-level PUT/DELETE need their own prefix when mounted at /api/campaigns
// We export a separate campaigns router to be mounted at /api/campaigns
export const campaignRouter = Router();
campaignRouter.put('/:id', authenticate, updateCampaign);
campaignRouter.delete('/:id', authenticate, deleteCampaign);

export default router;
