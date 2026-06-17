import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';
import { nanoid } from 'nanoid';
import redis, { redisStatus } from '../config/redis.js';
import { contentQueue } from '../services/queueService.js';
import { videoProductionService } from '../services/VideoProductionService.js';
import { generateLyrics as generateLyricsService, generateImage as generateImageService, generateTextExplanation, generateInfographicBrief, generatePresentation } from '../services/geminiService.js';
import { checkUserViolations, analyzePrompt, recordViolation } from '../services/moderationService.js';
import { generateSongWithSuno } from '../services/sunoService.js';
import { uploadImage } from '../services/storageService.js';

// Memory fallback for jobs when Redis is offline
const memoryJobs = new Map<string, any>();

function updateMemoryJobStatus(jobId: string, status: string, message?: string, result?: any, error?: string) {
    const existing = memoryJobs.get(jobId);
    if (!existing) return;
    memoryJobs.set(jobId, {
        ...existing,
        status,
        message,
        result,
        error,
        updatedAt: new Date().toISOString()
    });
}

async function runJobInProcess(jobData: any, document?: any) {
    const { jobId, userId, question, profile, musicStyle, styleId, voiceStyle, aspectRatio, language, collectionId } = jobData;
    console.log(`[MemoryJob] Processing in-process job ${jobId} for user ${userId}`);

    try {
        // 1. Check if user is suspended
        const { isSuspended, suspensionEnd } = await checkUserViolations(userId);
        if (isSuspended) {
            const endDate = suspensionEnd ? new Date(suspensionEnd).toLocaleDateString() : 'indefinida';
            throw new Error(`Tu cuenta está suspendida hasta el ${endDate} debido a violaciones de la política de contenido.`);
        }

        // 2. AI Moderation Check
        updateMemoryJobStatus(jobId, 'PROCESSING', 'Verificando contenido...');
        const promptToAnalyze = `Tema: ${question}. Estilo: ${profile.title}. ${musicStyle ? `Estilo musical: ${musicStyle.name}` : ''}`;
        const moderationResult = await analyzePrompt(promptToAnalyze, userId);

        if (!moderationResult.isAppropriate) {
            await recordViolation({
                userId,
                violationType: 'INAPPROPRIATE_PROMPT',
                severity: 'LOW',
                description: `Prompt rechazado: ${moderationResult.reasoning}`,
                autoSuspend: true
            });
            throw new Error(`Contenido rechazado por política de moderación: ${moderationResult.reasoning}`);
        }

        updateMemoryJobStatus(jobId, 'PROCESSING', 'Iniciando generación...');
        let result: any;

        // Generation logic selection...
        if (profile.type === 'MUSICAL' || profile.type === 'MUSIC_VIDEO') {
            updateMemoryJobStatus(jobId, 'PROCESSING', 'Generando letra...');
            const lyricsPrompt = `Crea una letra de canción educativa sobre: "${question}"\n\nEstilo: ${musicStyle?.promptInstruction || 'Música educativa alegre'} \n\nIdioma: ${language || 'Spanish'}`;
            const { text: lyrics, metadata } = await generateLyricsService(lyricsPrompt, musicStyle?.name || 'educational', (msg) => updateMemoryJobStatus(jobId, 'PROCESSING', msg), document, styleId, language || 'Spanish');
            
            updateMemoryJobStatus(jobId, 'PROCESSING', 'Generando música...');
            const sunoResults = await generateSongWithSuno(lyrics, musicStyle?.sunoTags || 'educational', question, (msg) => updateMemoryJobStatus(jobId, 'PROCESSING', msg), profile.type === 'MUSIC_VIDEO');
            
            const mainResult = sunoResults[0];
            const isVideo = profile.type === 'MUSIC_VIDEO' && mainResult.videoUrl;
            result = {
                topic: question,
                mediaUrl: isVideo ? mainResult.videoUrl : mainResult.audioUrl,
                mediaType: isVideo ? 'VIDEO' : 'AUDIO',
                mimeType: isVideo ? 'video/mp4' : 'audio/mpeg',
                textSummary: lyrics,
                groundingMetadata: { ...metadata, imageUrl: mainResult.imageUrl, profileType: profile.type, profileTitle: profile.title }
            };
        } else if (profile.mediaType === 'IMAGE') {
            updateMemoryJobStatus(jobId, 'PROCESSING', 'Generando imagen...');
            const infographicBrief = await generateInfographicBrief(question, language || 'Spanish');
            const imagePrompt = `Create a ${styleId || 'realistic'} educational image explaining: "${question}". \n\nContent: ${infographicBrief}`;
            const { mediaUrl: base64Image, mimeType } = await generateImageService(imagePrompt, 'nano-banana', aspectRatio || '3:4');
            
            updateMemoryJobStatus(jobId, 'PROCESSING', 'Preservando imagen en storage...');
            const secureUrl = await uploadImage(base64Image, 'nutonia-images');
            
            updateMemoryJobStatus(jobId, 'PROCESSING', 'Generando explicaciones...');
            const { text: explanation, groundingMetadata } = await generateTextExplanation(question, profile, document, language || 'Spanish');
            
            result = {
                topic: question,
                mediaUrl: secureUrl,
                mediaType: 'IMAGE',
                mimeType,
                textSummary: explanation,
                groundingMetadata: { ...groundingMetadata, profileType: profile.type, profileTitle: profile.title }
            };
        } else if (profile.type === 'PRESENTATION') {
            updateMemoryJobStatus(jobId, 'PROCESSING', 'Generando presentación...');
            const { text: presentationText, imageUrl: coverUrl, metadata } = await generatePresentation(question, profile, styleId, language || 'Spanish');
            result = {
                topic: question,
                mediaUrl: coverUrl,
                mediaType: 'IMAGE',
                mimeType: 'image/png',
                textSummary: presentationText,
                groundingMetadata: { ...metadata, profileType: profile.type, profileTitle: profile.title }
            };
        } else if (profile.type === 'VIDEO_PRODUCTION') {
            const rawResult = await videoProductionService.produceVideo(question, 2, voiceStyle || 'Puck', styleId || 'Cinematic', musicStyle?.name || 'Documentary', 'Spanish', aspectRatio, (msg) => updateMemoryJobStatus(jobId, 'PROCESSING', msg));
            const parsedResult = JSON.parse(rawResult);
            result = { topic: question, mediaUrl: parsedResult.mediaUrl, mediaType: 'VIDEO_PLAYLIST', mimeType: 'application/json', textSummary: "Video generado con Nutonia", groundingMetadata: { profileType: profile.type, profileTitle: profile.title } };
        } else {
            throw new Error(`Unsupported profile type: ${profile.type}`);
        }

        // Common finalization logic
        if (!result.mediaUrl) throw new Error("Error: No se pudo obtener la URL del medio generado.");
        
        updateMemoryJobStatus(jobId, 'PROCESSING', 'Guardando contenido...');
        const { data: savedContent, error: dbError } = await supabaseAdmin.from('content').insert({
            creator_id: userId,
            topic: result.topic,
            media_type: result.mediaType === 'VIDEO_PLAYLIST' ? 'VIDEO' : result.mediaType,
            media_url: result.mediaUrl,
            text_summary: result.textSummary,
            grounding_metadata: result.groundingMetadata,
            is_public: true,
            collection_id: collectionId
        }).select().single();

        if (dbError) throw new Error(`Failed to save content: ${dbError.message}`);
        
        updateMemoryJobStatus(jobId, 'COMPLETED', 'Generación completada', { contentId: savedContent.id, ...result });
        console.log(`[MemoryJob] Job ${jobId} completed successfully!`);

    } catch (error: any) {
        console.error(`[MemoryJob] Job ${jobId} failed: `, error);
        updateMemoryJobStatus(jobId, 'FAILED', `Error: ${error.message}`, undefined, error.message);
    }
}


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
        const cost = 50; // Costo plano para todos los formatos en Beta

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

        // Create job metadata in Redis/Memory
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

        const isRedisOffline = redisStatus === 'OFFLINE' || redisStatus === 'ERROR' || redisStatus === 'DISCONNECTED' || redisStatus === 'INITIALIZING';

        if (isRedisOffline) {
            console.log(`[MemoryJob] Redis offline, initiating in-process job: ${jobId}`);
            memoryJobs.set(jobId, jobData);
            // Run in background
            runJobInProcess(jobData, document).catch(err => {
                console.error(`[MemoryJob] Background job error for ${jobId}:`, err);
            });
        } else {
            try {
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
            } catch (queueError) {
                console.warn('Queue submission failed, falling back to in-process memory queue:', queueError);
                memoryJobs.set(jobId, jobData);
                // Run in background
                runJobInProcess(jobData, document).catch(err => {
                    console.error(`[MemoryJob] Background job error for ${jobId}:`, err);
                });
            }
        }

        // Record Transaction
        await supabaseAdmin.from('credit_transactions').insert({
            user_id: req.user.id,
            amount: -cost,
            type: 'SPEND',
            description: `Generated ${profile.title} content`,
            metadata: { jobId, profileType: profile.type }
        });

        console.log(`Job ${jobId} registered for user ${req.user.id}. Cost: ${cost} (In-process fallback: ${isRedisOffline})`);

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

        let jobDataStr = null;
        try {
            jobDataStr = await redis.get(`job:${jobId}`);
        } catch (e) {
            console.warn(`Redis get failed for jobId ${jobId}, falling back to memory check.`);
        }

        let jobData = null;
        if (jobDataStr) {
            jobData = JSON.parse(jobDataStr);
        } else {
            jobData = memoryJobs.get(jobId);
        }

        if (!jobData) {
            res.status(404).json({ error: 'Job not found or expired' });
            return;
        }

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

/**
 * POST /api/generate/subtopics
 */
export async function generateSubtopics(req: AuthRequest, res: Response): Promise<void> {
    try {
        const { topic, context } = req.body;
        if (!topic) {
            res.status(400).json({ error: 'Topic is required' });
            return;
        }
        const result = await import('../services/geminiService.js').then(m => m.generateSubtopics(topic, context || ''));
        res.json(result);
    } catch (error: any) {
        console.error('Generate subtopics error:', error);
        res.status(500).json({ error: error.message });
    }
}
