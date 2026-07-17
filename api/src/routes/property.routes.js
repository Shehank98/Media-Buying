import { Router } from 'express';
import express from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { checkChannelAccess } from '../middleware/access.js';
import {
  list, create, update, getHistory, remove,
  uploadPropertyEvaluation, downloadPropertyEvaluation, deletePropertyEvaluation,
} from '../controllers/property.controller.js';

const router = Router();

router.get('/channel/:channelId', authenticate, checkChannelAccess, list);
router.post('/channel/:channelId', authenticate, requireRole('PLANNER', 'GROUP_HEAD', 'SUPER_ADMIN'), checkChannelAccess, create);
router.put('/:id', authenticate, requireRole('PLANNER', 'GROUP_HEAD', 'SUPER_ADMIN'), update);
router.delete('/:id', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD'), remove);
router.get('/:id/history', authenticate, getHistory);

// Evaluation document (PDF/Excel) on Google Drive - upload/replace, download, remove.
router.post(
  '/:id/evaluation',
  authenticate,
  requireRole('PLANNER', 'GROUP_HEAD', 'SUPER_ADMIN'),
  express.raw({ type: '*/*', limit: '25mb' }),
  uploadPropertyEvaluation,
);
router.get('/:id/evaluation', authenticate, downloadPropertyEvaluation);
router.delete('/:id/evaluation', authenticate, requireRole('PLANNER', 'GROUP_HEAD', 'SUPER_ADMIN'), deletePropertyEvaluation);

export default router;
