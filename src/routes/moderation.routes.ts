import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getPolicy, reportContent, getMyViolations } from '../controllers/moderationController.js';

const router = Router();

// Public routes (some require auth)
router.get('/policy', getPolicy);
router.post('/report', authMiddleware, reportContent);
router.get('/my-violations', authMiddleware, getMyViolations);

export default router;
