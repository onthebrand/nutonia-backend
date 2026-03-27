import { Response, Request } from 'express';
import { supabaseAdmin } from '../config/supabase.js';

/**
 * GET /api/feed/public
 */
export async function getPublicFeed(req: Request, res: Response): Promise<void> {
    try {
        const sort = req.query.sort as string;
        // In a real app, userId would come from auth middleware (req.user.id)
        // For this demo, we can pass it as a query param or header, or assume context if available.
        // Let's check a header 'x-user-id' which the frontend could send, or just fall back to generic.
        const userId = req.headers['x-user-id'] as string;

        // 1. Base Query: Fetch a candidate pool of public content
        let candidateQuery = supabaseAdmin
            .from('content')
            .select('*')
            .eq('is_public', true)
            .limit(100); // Fetch detailed pool to re-rank

        // If 'trending', we pre-sort by likes to get good candidates
        if (sort === 'trending') {
            // Temporary fallback: 'likes_count' column missing in DB
            candidateQuery = candidateQuery.order('created_at', { ascending: false });
        } else {
            // Default 'recent' or 'for_you' candidate generation
            candidateQuery = candidateQuery.order('created_at', { ascending: false });
        }

        const { data: candidates, error: candidateError } = await candidateQuery;

        if (candidateError) {
            console.error('Get feed error:', candidateError);
            res.status(500).json({ error: 'Failed to fetch feed' });
            return;
        }

        let finalContent = candidates || [];

        // 2. Personalization Logic (Only if sort is NOT 'trending' and we have a user)
        // If sort is 'trending', user explicitly asked for global popularity, so we arguably shouldn't personalize too heavily, 
        // OR we just use the candidates as is.
        // User request says: "En el feed 'para ti'" (For You), so this applies specifically to the default default/For You sort.
        if (sort !== 'trending' && userId) {
            try {
                // Fetch user's interests from their library history
                const { data: history } = await supabaseAdmin
                    .from('library_items')
                    .select('content_id, content:content(*)') // metrics from saved items
                    .eq('user_id', userId)
                    .order('created_at', { ascending: false })
                    .limit(20);

                if (history && history.length > 0) {
                    // Extract Preferences
                    const preferredTags = new Set<string>();
                    const preferredTypes = new Set<string>();

                    history.forEach((h: any) => {
                        const c = h.content;
                        if (!c) return;
                        // Tags
                        if (Array.isArray(c.tags)) {
                            c.tags.forEach((t: string) => preferredTags.add(t.toLowerCase()));
                        }
                        // Profile Type (e.g., VISUAL, MUSICAL)
                        if (c.grounding_metadata?.profileType) {
                            preferredTypes.add(c.grounding_metadata.profileType);
                        }
                    });

                    // Scoring Function
                    finalContent = finalContent.map((item: any) => {
                        let score = 0;

                        // Recency Score (decay) - simple version
                        // We keep original order roughly but boost matches

                        // Tag Match
                        if (Array.isArray(item.tags)) {
                            item.tags.forEach((t: string) => {
                                if (preferredTags.has(t.toLowerCase())) score += 10;
                            });
                        }

                        // Type Match
                        if (item.grounding_metadata?.profileType && preferredTypes.has(item.grounding_metadata.profileType)) {
                            score += 5;
                        }

                        // Add a base score from index to preserve some chronological decay (candidates are ordered by time)
                        // This prevents old highly-relevant stuff from burying new stuff completely? 
                        // Actually, 'For You' usually prioritizes relevance > time.
                        // But let's add a small tie-breaker using original index
                        const freshnessBonus = 5 * (1 - (candidates.indexOf(item) / candidates.length)); // 0-5 points
                        score += freshnessBonus;

                        return { item, score };
                    }).sort((a, b) => b.score - a.score)
                        .map(wrapped => wrapped.item);
                }
            } catch (personalizationError) {
                console.warn('Personalization failed, returning chronological', personalizationError);
            }
        }

        res.json({ content: finalContent.slice(0, 50) });
    } catch (error) {
        console.error('Get feed error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
