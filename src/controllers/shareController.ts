import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';
import { nanoid } from 'nanoid';
import { z } from 'zod';

const trackShareSchema = z.object({
    contentId: z.string().uuid(),
    platform: z.enum(['WHATSAPP', 'INSTAGRAM', 'TIKTOK', 'TWITTER', 'FACEBOOK', 'LINK']),
    referralCode: z.string().optional(),
});

/**
 * POST /api/share/track
 * Track a share event
 */
export async function trackShare(req: AuthRequest, res: Response): Promise<void> {
    try {
        const { contentId, platform, referralCode } = trackShareSchema.parse(req.body);

        // Insert share event
        const { error } = await supabaseAdmin
            .from('share_events')
            .insert({
                user_id: req.user?.id || null,
                content_id: contentId,
                platform,
                referral_code: referralCode,
            });

        if (error) {
            console.error('Track share error:', error);
            res.status(500).json({ error: 'Failed to track share' });
            return;
        }

        // Increment share count on content
        await supabaseAdmin.rpc('increment_shares', { content_id: contentId });

        res.json({ message: 'Share tracked successfully' });
    } catch (error) {
        if (error instanceof z.ZodError) {
            res.status(400).json({ error: 'Validation error', details: error.errors });
            return;
        }
        console.error('Track share error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * GET /api/share/stats/:contentId
 */
export async function getShareStats(req: Request, res: Response): Promise<void> {
    try {
        const { contentId } = req.params;

        // Get shares by platform
        const { data: shares, error } = await supabaseAdmin
            .from('share_events')
            .select('platform')
            .eq('content_id', contentId);

        if (error) {
            console.error('Get share stats error:', error);
            res.status(500).json({ error: 'Failed to get share stats' });
            return;
        }

        // Count by platform
        const statsByPlatform = shares.reduce((acc, share) => {
            acc[share.platform] = (acc[share.platform] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        res.json({
            contentId,
            totalShares: shares.length,
            byPlatform: statsByPlatform,
        });
    } catch (error) {
        console.error('Get share stats error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * POST /api/share/referral/generate
 */
export async function generateReferralCode(req: AuthRequest, res: Response): Promise<void> {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        // Check if user already has a referral code
        const { data: existing } = await supabaseAdmin
            .from('users')
            .select('channel_data')
            .eq('id', req.user.id)
            .single();

        if (existing?.channel_data?.referral_code) {
            res.json({ referralCode: existing.channel_data.referral_code });
            return;
        }

        // Generate new code
        const referralCode = nanoid(10);

        // Update user with referral code
        await supabaseAdmin
            .from('users')
            .update({
                channel_data: {
                    ...existing?.channel_data,
                    referral_code: referralCode,
                },
            })
            .eq('id', req.user.id);

        res.json({ referralCode });
    } catch (error) {
        console.error('Generate referral code error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * POST /api/share/referral/redeem
 */
export async function redeemReferralCode(req: AuthRequest, res: Response): Promise<void> {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { referralCode } = req.body;

        if (!referralCode) {
            res.status(400).json({ error: 'Missing referral code' });
            return;
        }

        // Find referrer
        const { data: referrer, error: referrerError } = await supabaseAdmin
            .from('users')
            .select('id, credits')
            .contains('channel_data', { referral_code: referralCode })
            .single();

        if (referrerError || !referrer) {
            res.status(404).json({ error: 'Invalid referral code' });
            return;
        }

        if (referrer.id === req.user.id) {
            res.status(400).json({ error: 'Cannot redeem your own referral code' });
            return;
        }

        // Check if already redeemed
        const { data: existing } = await supabaseAdmin
            .from('share_events')
            .select('id')
            .eq('referral_code', referralCode)
            .eq('converted', true)
            .limit(1);

        if (existing && existing.length > 0) {
            res.status(400).json({ error: 'Referral code already redeemed' });
            return;
        }

        // Award credits to both users
        const REFERRAL_REWARD = 5;

        // Update referrer credits
        await supabaseAdmin.rpc('increment_credits', {
            user_id: referrer.id,
            amount: REFERRAL_REWARD,
        });

        // Update new user credits
        await supabaseAdmin.rpc('increment_credits', {
            user_id: req.user.id,
            amount: REFERRAL_REWARD,
        });

        // Create credit transactions
        await supabaseAdmin.from('credit_transactions').insert([
            {
                user_id: referrer.id,
                amount: REFERRAL_REWARD,
                type: 'EARN',
                description: `Referral bonus (invited user)`,
            },
            {
                user_id: req.user.id,
                amount: REFERRAL_REWARD,
                type: 'EARN',
                description: `Referral bonus (invited by ${referrer.id})`,
            },
        ]);

        // Mark conversion
        await supabaseAdmin.from('share_events').insert({
            user_id: req.user.id,
            referral_code: referralCode,
            converted: true,
        });

        res.json({
            message: `Referral redeemed! You and your referrer each received ${REFERRAL_REWARD} credits.`,
            creditsEarned: REFERRAL_REWARD,
        });
    } catch (error) {
        console.error('Redeem referral code error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * GET /api/share/referral/stats
 */
export async function getReferralStats(req: AuthRequest, res: Response): Promise<void> {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        // Get user's referral code
        const { data: user } = await supabaseAdmin
            .from('users')
            .select('channel_data')
            .eq('id', req.user.id)
            .single();

        const referralCode = user?.channel_data?.referral_code;

        if (!referralCode) {
            res.json({ conversions: 0, totalEarnings: 0 });
            return;
        }

        // Count conversions
        const { data: conversions } = await supabaseAdmin
            .from('share_events')
            .select('id')
            .eq('referral_code', referralCode)
            .eq('converted', true);

        const conversionCount = conversions?.length || 0;
        const REFERRAL_REWARD = 5;

        res.json({
            referralCode,
            conversions: conversionCount,
            totalEarnings: conversionCount * REFERRAL_REWARD,
        });
    } catch (error) {
        console.error('Get referral stats error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
