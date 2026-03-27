import { Router } from 'express';
import { getPublicFeed } from '../controllers/feedController.js';

const router = Router();

// GET /api/feed/public
router.get('/public', getPublicFeed);

export default router;
