import { Router } from 'express';
import { optionalAuthMiddleware } from '../middleware/auth.js';
import { getUserProfile } from '../controllers/usersController.js';

const router = Router();

// Get public user profile
router.get('/:username', optionalAuthMiddleware, getUserProfile);

export default router;
