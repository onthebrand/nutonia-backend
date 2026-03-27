import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';

/**
 * GET /api/library
 */
export async function getLibrary(req: AuthRequest, res: Response): Promise<void> {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const from = (page - 1) * limit;
        const to = from + limit - 1;

        let query = supabaseAdmin
            .from('content')
            .select('*', { count: 'exact' })
            .eq('creator_id', req.user.id)
            .order('created_at', { ascending: false })
            .range(from, to);

        if (req.query.isPublic === 'true') {
            query = query.eq('is_public', true);
        }

        const { data, error } = await query;

        if (error) {
            console.error('Get library error:', error);
            res.status(500).json({ error: 'Failed to fetch library' });
            return;
        }

        res.json({ content: data });
    } catch (error) {
        console.error('Get library error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * POST /api/library
 */
export async function saveToLibrary(req: AuthRequest, res: Response): Promise<void> {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { topic, mediaType, mediaUrl, textSummary, groundingMetadata, styleTags, isPublic } = req.body;

        if (!topic || !mediaType || !mediaUrl) {
            res.status(400).json({ error: 'Missing required fields' });
            return;
        }

        const { data, error } = await supabaseAdmin
            .from('content')
            .insert({
                creator_id: req.user.id,
                topic,
                media_type: mediaType === 'VIDEO_PLAYLIST' ? 'VIDEO' : mediaType,
                media_url: mediaUrl,
                text_summary: textSummary,
                grounding_metadata: groundingMetadata,
                style_tags: styleTags || [],
                is_public: isPublic !== undefined ? isPublic : true,
            })
            .select()
            .single();

        if (error) {
            console.error('Save to library error:', error);
            res.status(500).json({ error: 'Failed to save content' });
            return;
        }

        res.status(201).json({ content: data });
    } catch (error) {
        console.error('Save to library error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * DELETE /api/library/:id
 */
export async function deleteFromLibrary(req: AuthRequest, res: Response): Promise<void> {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { id } = req.params;

        const { error } = await supabaseAdmin
            .from('content')
            .delete()
            .eq('id', id)
            .eq('creator_id', req.user.id);

        if (error) {
            console.error('Delete from library error:', error);
            res.status(500).json({ error: 'Failed to delete content' });
            return;
        }

        res.json({ message: 'Content deleted successfully' });
    } catch (error) {
        console.error('Delete from library error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * PUT /api/library/:id
 */
export async function updateContent(req: AuthRequest, res: Response): Promise<void> {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { id } = req.params;
        const { isPublic } = req.body;

        const updates: any = {};
        if (typeof isPublic === 'boolean') updates.is_public = isPublic;

        const { data, error } = await supabaseAdmin
            .from('content')
            .update(updates)
            .eq('id', id)
            .eq('creator_id', req.user.id)
            .select()
            .single();

        if (error) {
            console.error('Update content error:', error);
            res.status(500).json({ error: 'Failed to update content' });
            return;
        }

        res.json({ content: data });
    } catch (error) {
        console.error('Update content error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
