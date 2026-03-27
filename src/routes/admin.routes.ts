import { Router } from 'express';
import { getDashboardStats } from '../controllers/adminController.js';

const router = Router();

// In a real app, add auth middleware here: router.use(authenticateAdmin);
router.get('/stats', getDashboardStats);

export default router;
