import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { list, create, update, getHistory, remove } from '../controllers/property.controller.js';

const router = Router();

router.get('/channel/:channelId', authenticate, list);
router.post('/channel/:channelId', authenticate, requireRole('PLANNER', 'GROUP_HEAD', 'SUPER_ADMIN'), create);
router.put('/:id', authenticate, update);
router.delete('/:id', authenticate, remove);
router.get('/:id/history', authenticate, getHistory);

export default router;
