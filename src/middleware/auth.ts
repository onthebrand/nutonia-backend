import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../config/supabase.js';

export interface AuthRequest extends Request {
    user?: {
        id: string;
        email: string;
        role: string;
    };
}

/**
 * Middleware to verify Supabase JWT token
 */
export async function authMiddleware(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).json({ error: 'Missing or invalid authorization header' });
            return;
        }

        const token = authHeader.substring(7); // Remove 'Bearer ' prefix

        // Verify token with Supabase
        const { data, error } = await supabaseAdmin.auth.getUser(token);

        if (error || !data.user) {
            res.status(401).json({ error: 'Invalid or expired token' });
            return;
        }

        // Get user profile from database
        const { data: profile, error: profileError } = await supabaseAdmin
            .from('users')
            .select('id, email, role, credits')
            .eq('id', data.user.id)
            .single();

        if (profileError || !profile) {
            res.status(404).json({ error: 'User profile not found' });
            return;
        }

        // Attach user to request
        req.user = {
            id: profile.id,
            email: profile.email,
            role: profile.role,
        };

        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        res.status(500).json({ error: 'Internal server error during authentication' });
    }
}

/**
 * Optional auth middleware - doesn't fail if no token
 */
export async function optionalAuthMiddleware(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        next();
        return;
    }

    // If token exists, verify it
    await authMiddleware(req, res, next);
}
