import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { globalSearch } from '../controllers/search.controller.js';

const router = Router();

router.get('/', authenticate, globalSearch);

export default router;
