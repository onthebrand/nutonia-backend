import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getBalance, purchaseCredits, getHistory, redeemPromoCode, handleMercadoPagoWebhook } from '../controllers/creditsController.js';

const router = Router();

// Webhook (no auth)
router.post('/mercadopago/webhook', handleMercadoPagoWebhook);

// Protected routes
router.use(authMiddleware);

router.get('/balance', getBalance);
router.post('/purchase', purchaseCredits);
router.get('/history', getHistory);
router.post('/redeem', redeemPromoCode);

export default router;
