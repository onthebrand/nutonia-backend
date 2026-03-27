import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';
import { supabaseAdmin } from '../config/supabase.js';

/**
 * Middleware to check if user has enough credits
 */
export async function checkCredits(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        // Get user's current credits and role
        const { data: user, error } = await supabaseAdmin
            .from('users')
            .select('credits, role')
            .eq('id', req.user.id)
            .single();

        if (error || !user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        // Bypass check for admins
        if (user.role === 'ADMIN') {
            next();
            return;
        }

        if (user.credits <= 0) {
            res.status(402).json({
                error: 'Insufficient credits',
                message: 'You need to purchase more credits to generate content.',
                credits: 0,
            });
            return;
        }

        next();
    } catch (error) {
        console.error('Credits check error:', error);
        res.status(500).json({ error: 'Error checking credits' });
    }
}
