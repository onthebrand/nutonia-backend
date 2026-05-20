import { Response, Request } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { redis, redisStatus } from '../config/redis.js';

/**
 * GET /api/feed/public
 */
export async function getPublicFeed(req: Request, res: Response): Promise<void> {
    try {
        const sort = req.query.sort as string || 'recent';
        const userId = req.headers['x-user-id'] as string;
        const cacheKey = `feed:public:${sort}:${userId || 'anon'}`;

        // 1. Try Cache First (only for non-personalized or trending)
        if (redisStatus === 'CONNECTED') {
            try {
                const cached = await redis.get(cacheKey);
                if (cached) {
                    console.log(`[FeedController] Cache HIT for ${cacheKey}`);
                    res.json(JSON.parse(cached));
                    return;
                }
                console.log(`[FeedController] Cache MISS for ${cacheKey}`);
            } catch (cacheError) {
                console.warn('[FeedController] Cache read failed:', cacheError);
            }
        }

        // 2. Base Query: Fetch a candidate pool of public content
        const poolSize = sort === 'trending' ? 30 : 100; // Trending needs fewer candidates to re-rank
        let candidateQuery = supabaseAdmin
            .from('content')
            .select('*')
            .eq('is_public', true)
            .limit(poolSize);

        if (sort === 'trending') {
            candidateQuery = candidateQuery.order('created_at', { ascending: false });
        } else {
            candidateQuery = candidateQuery.order('created_at', { ascending: false });
        }

        const { data: candidates, error: candidateError } = await candidateQuery;
        
        if (candidateError) {
            console.error('Get feed error:', candidateError);
            res.status(500).json({ error: 'Failed to fetch feed' });
            return;
        }

        let finalContent = candidates || [];

        // 3. Personalization Logic (skipped for simplicity if cache was missed and not explicit 'for_you')
        if (sort !== 'trending' && userId && finalContent.length > 0) {
            try {
                // ... (existing personalization logic)
                const { data: history } = await supabaseAdmin
                    .from('library_items')
                    .select('content_id, content:content(*)')
                    .eq('user_id', userId)
                    .order('created_at', { ascending: false })
                    .limit(10);

                if (history && history.length > 0) {
                    const preferredTypes = new Set<string>();
                    history.forEach((h: any) => {
                        if (h.content?.grounding_metadata?.profileType) {
                            preferredTypes.add(h.content.grounding_metadata.profileType);
                        }
                    });

                    finalContent = finalContent.map((item: any) => {
                        let score = 0;
                        if (item.grounding_metadata?.profileType && preferredTypes.has(item.grounding_metadata.profileType)) {
                            score += 10;
                        }
                        return { item, score };
                    }).sort((a, b) => b.score - a.score)
                        .map(wrapped => wrapped.item);
                }
            } catch (pError) {
                console.warn('Personalization failed:', pError);
            }
        }

        const result = { content: finalContent.slice(0, 40) };

        // 4. Save to Cache
        if (redisStatus === 'CONNECTED') {
            try {
                await redis.setex(cacheKey, 600, JSON.stringify(result)); // Cache for 10 minutes
                console.log(`[FeedController] Cache SAVED for ${cacheKey}`);
            } catch (saveError) {
                console.warn('[FeedController] Cache write failed:', saveError);
            }
        }

        res.json(result);

    } catch (error) {
        console.error('Get feed error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
