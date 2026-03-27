import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';

/**
 * GET /api/playlists
 */
export async function getPlaylists(req: AuthRequest, res: Response): Promise<void> {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { data, error } = await supabaseAdmin
            .from('playlists')
            .select(`
                *,
                items:playlist_items(
                    content:content(*)
                )
            `)
            .or(`is_public.eq.true,creator_id.eq.${req.user.id}`)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Get playlists error:', error);
            res.status(500).json({ error: 'Failed to fetch playlists' });
            return;
        }

        // Transform data to match frontend expectation if needed
        // For now returning raw
        if (data) {
            console.log(`[GetPlaylists] Retrieved ${data.length} playlists`);
            data.forEach(p => {
                // Check if items is array or null/undefined
                const count = Array.isArray(p.items) ? p.items.length : 'N/A';
                console.log(`Playlist ${p.id} has ${count} items`);
            });
        }
        res.json({ playlists: data });
    } catch (error) {
        console.error('Get playlists error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * POST /api/playlists
 */
export async function createPlaylist(req: AuthRequest, res: Response): Promise<void> {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { title, description, category, isPublic, items } = req.body;

        if (!title) {
            res.status(400).json({ error: 'Title is required' });
            return;
        }

        // 1. Create Playlist
        const { data: playlist, error: playlistError } = await supabaseAdmin
            .from('playlists')
            .insert({
                creator_id: req.user.id,
                title,
                description,
                category: category || 'DIDACTIC',
                is_public: isPublic ?? true
            })
            .select()
            .single();

        if (playlistError) {
            console.error('Create playlist error:', playlistError);
            res.status(500).json({ error: 'Failed to create playlist' });
            return;
        }

        // 2. Add Items
        // 2. Add Items
        console.log(`[CreatePlaylist] Adding ${items?.length} items to playlist ${playlist.id}`);

        if (items && items.length > 0) {
            // Validate Items
            const validItems = [];
            for (const id of items) {
                if (typeof id === 'string' && id.length === 36) { // Basic UUID length check
                    validItems.push(id);
                } else {
                    console.warn(`[CreatePlaylist] Invalid item ID format: ${id}`);
                }
            }

            if (validItems.length === 0) {
                console.warn('[CreatePlaylist] No valid item IDs found in payload');
                // Don't fail the whole request, but warn.
            } else {
                console.log(`[CreatePlaylist] Validated ${validItems.length} items to insert`);

                const playlistItems = validItems.map((contentId: string, index: number) => ({
                    playlist_id: playlist.id,
                    content_id: contentId,
                    position: index
                }));

                const { error: itemsError, data: insertedItems } = await supabaseAdmin
                    .from('playlist_items')
                    .insert(playlistItems)
                    .select();

                if (itemsError) {
                    console.error('[CreatePlaylist] Add items error (FULL):', JSON.stringify(itemsError));
                    // Return error to client so they know it failed
                    res.status(500).json({ error: 'Playlist created but failed to add items', details: itemsError });
                    return;
                } else {
                    console.log(`[CreatePlaylist] Successfully added items:`, insertedItems?.length);
                }
            }
        } else {
            console.warn('[CreatePlaylist] No items provided to add');
        }

        // Fetch fresh playlist with items
        const { data: finalPlaylist } = await supabaseAdmin
            .from('playlists')
            .select(`
                *,
                items:playlist_items(
                    content:content(*)
                )
            `)
            .eq('id', playlist.id)
            .single();

        res.status(201).json({ playlist: finalPlaylist || playlist });
    } catch (error) {
        console.error('Create playlist error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * DELETE /api/playlists/:id
 */
export async function deletePlaylist(req: AuthRequest, res: Response): Promise<void> {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { id } = req.params;

        // 1. Delete items first (though cascade might handle this, manual is safer for debugging)
        const { error: itemsError } = await supabaseAdmin
            .from('playlist_items')
            .delete()
            .eq('playlist_id', id);

        if (itemsError) {
            console.warn('Error deleting playlist items (might be fine if cascade exists):', itemsError);
        }

        // 2. Delete Playlist
        const { error } = await supabaseAdmin
            .from('playlists')
            .delete()
            .eq('id', id)
            .eq('creator_id', req.user.id);

        if (error) {
            console.error('Delete playlist error:', error);
            res.status(500).json({ error: 'Failed to delete playlist' });
            return;
        }

        res.json({ message: 'Playlist deleted' });
    } catch (error) {
        console.error('Delete playlist error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * PUT /api/playlists/:id
 */
export async function updatePlaylist(req: AuthRequest, res: Response): Promise<void> {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { id } = req.params;
        const updates = req.body; // Expect { isPublic: boolean, ... }

        // Security check: ensure user owns the playlist
        const { data: existing, error: fetchError } = await supabaseAdmin
            .from('playlists')
            .select('creator_id')
            .eq('id', id)
            .single();

        if (fetchError || !existing) {
            res.status(404).json({ error: 'Playlist not found' });
            return;
        }

        if (existing.creator_id !== req.user.id) {
            res.status(403).json({ error: 'You do not have permission to update this playlist' });
            return;
        }

        // Perform Update
        const dbUpdates: any = {};
        if (updates.isPublic !== undefined) dbUpdates.is_public = updates.isPublic;
        // Add other fields as needed
        if (updates.title !== undefined) dbUpdates.title = updates.title;

        const { data: updated, error: updateError } = await supabaseAdmin
            .from('playlists')
            .update(dbUpdates)
            .eq('id', id)
            .select()
            .single();

        if (updateError) {
            console.error('Update playlist error:', updateError);
            res.status(500).json({ error: 'Failed to update playlist' });
            return;
        }

        res.json({ playlist: updated });
    } catch (error) {
        console.error('Update playlist error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
