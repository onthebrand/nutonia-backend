import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';
import { z } from 'zod';

const purchaseSchema = z.object({
    tier: z.enum(['PRO_MONTHLY', 'PREMIUM_MONTHLY', 'PACK_50']),
});

// Product configurations
const PRODUCTS = {
    PRO_MONTHLY: {
        id: 'pro_monthly',
        title: 'Plan Pro Mensual',
        price: 9990, // CLP
        credits: 100,
        currency: 'CLP',
    },
    PREMIUM_MONTHLY: {
        id: 'premium_monthly',
        title: 'Plan Premium Mensual',
        price: 19990, // CLP
        credits: 250,
        currency: 'CLP',
    },
    PACK_50: {
        id: 'pack_50',
        title: 'Pack 50 Créditos',
        price: 4990, // CLP
        credits: 50,
        currency: 'CLP',
    },
};

/**
 * GET /api/credits/balance
 */
export async function getBalance(req: AuthRequest, res: Response): Promise<void> {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { data: user } = await supabaseAdmin
            .from('users')
            .select('credits')
            .eq('id', req.user.id)
            .single();

        res.json({ credits: user?.credits || 0 });
    } catch (error) {
        console.error('Get balance error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * POST /api/credits/purchase
 * Create MercadoPago payment preference
 */
export async function purchaseCredits(req: AuthRequest, res: Response): Promise<void> {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { tier } = purchaseSchema.parse(req.body);
        const product = PRODUCTS[tier];

        // Create MercadoPago preference
        // Note: This is a simplified version. In production, use the MercadoPago SDK
        const preferenceData = {
            items: [
                {
                    id: product.id,
                    title: product.title,
                    quantity: 1,
                    unit_price: product.price,
                    currency_id: product.currency,
                },
            ],
            back_urls: {
                success: `${process.env.FRONTEND_URL}/payment/success`,
                failure: `${process.env.FRONTEND_URL}/payment/failure`,
                pending: `${process.env.FRONTEND_URL}/payment/pending`,
            },
            auto_return: 'approved',
            metadata: {
                user_id: req.user.id,
                tier,
                credits: product.credits,
            },
            notification_url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/credits/mercadopago/webhook`,
        };

        // TODO: Call MercadoPago SDK to create preference
        // For now, we return mock data
        const mockPreferenceId = 'mock-preference-id-' + Date.now();

        res.json({
            preferenceId: mockPreferenceId,
            initPoint: `https://www.mercadopago.cl/checkout/v1/redirect?pref_id=${mockPreferenceId}`,
            product,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            res.status(400).json({ error: 'Validation error', details: error.errors });
            return;
        }
        console.error('Purchase credits error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * GET /api/credits/history
 */
export async function getHistory(req: AuthRequest, res: Response): Promise<void> {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { data, error } = await supabaseAdmin
            .from('credit_transactions')
            .select('*')
            .eq('user_id', req.user.id)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) {
            console.error('Get history error:', error);
            res.status(500).json({ error: 'Failed to fetch transaction history' });
            return;
        }

        res.json({ transactions: data });
    } catch (error) {
        console.error('Get history error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * POST /api/credits/redeem
 * Redeem promo code
 */
export async function redeemPromoCode(req: AuthRequest, res: Response): Promise<void> {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { code } = req.body;

        if (!code) {
            res.status(400).json({ error: 'Missing promo code' });
            return;
        }

        // TODO: Implement promo codes table and validation
        // For now, return mock error
        res.status(404).json({ error: 'Invalid promo code' });
    } catch (error) {
        console.error('Redeem promo code error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * POST /api/credits/mercadopago/webhook
 * MercadoPago payment notification webhook
 */
export async function handleMercadoPagoWebhook(req: Request, res: Response): Promise<void> {
    try {
        console.log('MercadoPago webhook received:', req.body);

        const { type, data } = req.body;

        // Only process payment notifications
        if (type !== 'payment') {
            res.sendStatus(200);
            return;
        }

        // TODO: Verify webhook authenticity with MercadoPago
        // TODO: Fetch payment details from MercadoPago API
        // TODO: Extract user_id and credits from payment metadata
        // TODO: Update user credits in database
        // TODO: Create credit transaction record

        // Mock implementation
        const paymentId = data.id;
        console.log(`Payment ${paymentId} processed`);

        res.sendStatus(200);
    } catch (error) {
        console.error('MercadoPago webhook error:', error);
        res.sendStatus(500);
    }
}
