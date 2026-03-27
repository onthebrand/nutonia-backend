import { Router } from 'express';
import { authRateLimiter } from '../middleware/rateLimit.js';
import { register, login, getMe, syncUser, updateProfile } from '../controllers/authController.js';

const router = Router();

// Public routes
router.post('/register', authRateLimiter, register);
router.post('/login', authRateLimiter, login);

// Protected routes
router.get('/me', getMe);
router.post('/sync-user', syncUser);
router.put('/profile', updateProfile);

export default router;
