import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';
import { nanoid } from 'nanoid';
import redis from '../config/redis.js';
import { contentQueue } from '../services/queueService.js';
import { videoProductionService } from '../services/VideoProductionService.js';
import { generateLyrics as generateLyricsService } from '../services/geminiService.js';

/**
 * POST /api/generate/content
 * Queues content generation job
 */
export async function generateContent(req: AuthRequest, res: Response): Promise<void> {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { question, profile, musicStyle, styleId, document, voiceStyle, aspectRatio, language, collectionId } = req.body;

        if ((!question && !document) || !profile) {
            res.status(400).json({ error: 'Missing required fields: question (or document) and profile' });
            return;
        }

        // Determine Cost
        let cost = 10; // Default for text/image
        if (profile.type === 'KINESTHETIC' || profile.type === 'MUSIC_VIDEO' || profile.type === 'VIDEO_PRODUCTION' || profile.type === 'INTERACTIVE_WEB') {
            cost = 50;
        } else if (profile.type === 'MUSICAL') {
            cost = 25;
        }

        // Check and Deduct Credits (Atomically)
        const { data: success, error: creditError } = await supabaseAdmin
            .rpc('decrement_credits', {
                user_id: req.user.id,
                amount: cost
            });

        if (creditError) {
            console.error('Credit deduction error:', creditError);
            res.status(500).json({ error: 'Failed to process credits' });
            return;
        }

        if (!success) {
            // Insufficient credits
            res.status(402).json({ error: 'Insufficient credits', required: cost });
            return;
        }

        // Generate unique job ID
        const jobId = nanoid();

        // Create job metadata in Redis
        const jobData = {
            jobId,
            userId: req.user.id,
            question,
            profile,
            musicStyle,
            styleId,
            voiceStyle,
            aspectRatio,
            language,
            collectionId,
            cost, // Track cost for potential refunds
            status: 'QUEUED',
            message: 'Esperando en cola...',
            createdAt: new Date().toISOString(),
        };

        await redis.set(`job:${jobId}`, JSON.stringify(jobData), 'EX', 3600); // 1 hour expiry

        // Add job to BullMQ queue
        await contentQueue.add(
            'generate',
            {
                jobId,
                userId: req.user.id,
                question,
                profile,
                musicStyle,
                styleId,
                document,
                voiceStyle,
                aspectRatio,
                language,
                collectionId
            },
            {
                jobId, // Use our jobId as BullMQ job ID
            }
        );

        // Record Transaction
        await supabaseAdmin.from('credit_transactions').insert({
            user_id: req.user.id,
            amount: -cost,
            type: 'SPEND',
            description: `Generated ${profile.title} content`,
            metadata: { jobId, profileType: profile.type }
        });

        console.log(`Job ${jobId} queued for user ${req.user.id}. Cost: ${cost}`);

        res.status(202).json({
            jobId,
            status: 'QUEUED',
            message: 'Content generation queued. Poll /api/generate/status/:jobId for updates.',
        });
    } catch (error) {
        console.error('Generate content error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * POST /api/generate/video-production
 * Triggers high-quality video production
 */
export async function produceVideo(req: AuthRequest, res: Response): Promise<void> {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { topic, durationMinutes, voiceStyle, visualStyle, genre, language, aspectRatio } = req.body;

        if (!topic) {
            res.status(400).json({ error: 'Topic is required' });
            return;
        }

        // For this MVP, we are awaiting the result directly. 
        // In production, this should also be queued like generateContent.
        const result = await videoProductionService.produceVideo(topic, durationMinutes || 2, voiceStyle, visualStyle, genre, language, aspectRatio);

        // Result is a JSON string of the playlist/manifest
        res.json(JSON.parse(result));

    } catch (error: any) {
        console.error('Video production error:', error);
        res.status(500).json({ error: error.message });
    }
}

/**
 * POST /api/generate/lyrics
 */
export async function generateLyrics(req: AuthRequest, res: Response): Promise<void> {
    try {
        const { prompt, style } = req.body;
        const result = await generateLyricsService(prompt, style);
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
}
/**
 * POST /api/generate/image
 */
export async function generateImage(req: AuthRequest, res: Response): Promise<void> {
    try {
        const { prompt, model } = req.body;
        // Basic credit check could go here, for now MVP
        const result = await import('../services/geminiService.js').then(m => m.generateImage(prompt, model));
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
}

/**
 * GET /api/generate/status/:jobId
 * Get generation job status
 */
export async function getGenerationStatus(req: AuthRequest, res: Response): Promise<void> {
    try {
        const { jobId } = req.params;

        const jobDataStr = await redis.get(`job:${jobId}`);
        if (!jobDataStr) {
            res.status(404).json({ error: 'Job not found or expired' });
            return;
        }

        const jobData = JSON.parse(jobDataStr);

        // Check if user owns this job (allow viewing if authenticated)
        if (req.user && jobData.userId !== req.user.id) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        res.json({
            jobId,
            status: jobData.status,
            message: jobData.message,
            result: jobData.result,
            error: jobData.error,
            createdAt: jobData.createdAt,
            completedAt: jobData.completedAt,
        });
    } catch (error) {
        console.error('Get generation status error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
