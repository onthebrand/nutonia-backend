import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';

/**
 * GET /api/users/:username
 */
export async function getUserProfile(req: AuthRequest, res: Response): Promise<void> {
    try {
        const { username } = req.params;

        const { data: user, error } = await supabaseAdmin
            .from('users')
            .select('id, username, email, channel_data, created_at, bio, avatar_url')
            .eq('username', username)
            .single();

        if (error || !user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        // Get public content count
        const { count } = await supabaseAdmin
            .from('content')
            .select('id', { count: 'exact', head: true })
            .eq('creator_id', user.id)
            .eq('is_public', true);

        res.json({
            user: {
                id: user.id,
                username: user.username,
                channelData: user.channel_data,
                createdAt: user.created_at,
                publicContentCount: count || 0,
                bio: user.bio,
                avatarUrl: user.avatar_url
            },
        });
    } catch (error) {
        console.error('Get user profile error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
