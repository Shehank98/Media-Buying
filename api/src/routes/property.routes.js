import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { checkChannelAccess } from '../middleware/access.js';
import { list, create, update, getHistory, remove } from '../controllers/property.controller.js';

const router = Router();

router.get('/channel/:channelId', authenticate, checkChannelAccess, list);
router.post('/channel/:channelId', authenticate, requireRole('PLANNER', 'GROUP_HEAD', 'SUPER_ADMIN'), checkChannelAccess, create);
router.put('/:id', authenticate, requireRole('PLANNER', 'GROUP_HEAD', 'SUPER_ADMIN'), update);
router.delete('/:id', authenticate, requireRole('SUPER_ADMIN', 'GROUP_HEAD'), remove);
router.get('/:id/history', authenticate, getHistory);

export default router;
