import { Router } from 'express';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.js';
import { trackShare, getShareStats, generateReferralCode, redeemReferralCode, getReferralStats } from '../controllers/shareController.js';

const router = Router();

// Track share event (can be anonymous)
router.post('/track', optionalAuthMiddleware, trackShare);

// Get share stats for content (public)
router.get('/stats/:contentId', getShareStats);

// Referral system (requires auth)
router.post('/referral/generate', authMiddleware, generateReferralCode);
router.post('/referral/redeem', authMiddleware, redeemReferralCode);
router.get('/referral/stats', authMiddleware, getReferralStats);

export default router;
