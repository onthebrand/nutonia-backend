
import { Queue, Worker, Job } from 'bullmq';
import redis, { redisStatus } from '../config/redis.js';
import { supabaseAdmin } from '../config/supabase.js';
import { generateLyrics, generateImage, generateTextExplanation, generatePresentation, generateInfographicBrief, generateMiniGame, generateInteractiveWeb } from './geminiService.js';
import { generateSongWithSuno } from './sunoService.js';
import { uploadImage } from './storageService.js';
import { analyzePrompt, checkUserViolations, recordViolation } from './moderationService.js';
import { videoProductionService } from './VideoProductionService.js';

// Queue for content generation jobs
export let contentQueue: any = null;

try {
    contentQueue = new Queue('content-generation', {
        connection: redis,
        defaultJobOptions: {
            attempts: 2,
            backoff: {
                type: 'exponential',
                delay: 2000,
            },
            removeOnComplete: {
                age: 3600, // Keep completed jobs for 1 hour
                count: 100,
            },
            removeOnFail: false, // Keep failed jobs for debugging
        },
    });

    contentQueue.on('error', (err: any) => {
        console.error('Queue error:', err.message);
    });
} catch (e: any) {
    console.error('Failed to initialize content queue:', e.message);
}

// Debug: Log queue status on startup
if (contentQueue && redisStatus !== 'OFFLINE') {
    contentQueue.getJobCounts().catch(() => {
        return null;
    }).then(async (counts: any) => {
        if (!counts) return;
        console.log('Current Queue Counts:', counts);
        // EMERGENCY CLEAR: If active > 0 on startup, it's stuck.
        if (counts.active > 0 || counts.waiting > 0) {
            console.warn('⚠️ Clearing stuck queue...');
            try {
                await contentQueue.obliterate({ force: true });
                console.log('✓ Queue cleared');
            } catch (e) {
                // Silently ignore if obliterate fails
            }
        }
    });
} else {
    console.warn('⚠️ Redis is OFFLINE. Queued content generation will not be available.');
}

interface GenerationJobData {
    jobId: string;
    userId: string;
    question: string;
    profile: any;
    musicStyle?: any;
    styleId?: string;
    document?: { content: string; mimeType: string };
    inputImages?: string[];
    urlInput?: string;
    voiceStyle?: string;
    aspectRatio?: string;
    language?: string;
    collectionId?: string;
}

/**
 * Worker to process content generation jobs
 */
export let contentWorker: any = null;

if (redisStatus !== 'OFFLINE') {
    try {
        contentWorker = new Worker(
            'content-generation',
            async (job: Job<GenerationJobData>) => {
                const { jobId, userId, question, profile, musicStyle, styleId, inputImages, urlInput, document, voiceStyle, aspectRatio, language, collectionId } = job.data;

                console.log(`Processing job ${jobId} for user ${userId}`);

                try {
                    // 1. Check if user is suspended
                    const { isSuspended, suspensionEnd } = await checkUserViolations(userId);
                    if (isSuspended) {
                        const endDate = suspensionEnd ? new Date(suspensionEnd).toLocaleDateString() : 'indefinida';
                        throw new Error(`Tu cuenta está suspendida hasta el ${endDate} debido a violaciones de la política de contenido.`);
                    }

                    // 2. AI Moderation Check
                    await updateJobStatus(jobId, 'PROCESSING', 'Verificando contenido...');
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

                    await updateJobStatus(jobId, 'PROCESSING', 'Iniciando generación...');
                    let result: any;

                    // Generation logic selection...
                    if (profile.type === 'MUSICAL' || profile.type === 'MUSIC_VIDEO') {
                        await updateJobStatus(jobId, 'PROCESSING', 'Generando letra...');
                        const lyricsPrompt = `Crea una letra de canción educativa sobre: "${question}"\n\nEstilo: ${musicStyle?.promptInstruction || 'Música educativa alegre'} \n\nIdioma: ${language || 'Spanish'}`;
                        const { text: lyrics, metadata } = await generateLyrics(lyricsPrompt, musicStyle?.name || 'educational', (msg) => updateJobStatus(jobId, 'PROCESSING', msg), document, styleId, language || 'Spanish');
                        
                        await updateJobStatus(jobId, 'PROCESSING', 'Generando música...');
                        const sunoResults = await generateSongWithSuno(lyrics, musicStyle?.sunoTags || 'educational', question, (msg) => updateJobStatus(jobId, 'PROCESSING', msg), profile.type === 'MUSIC_VIDEO');
                        
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
                        await updateJobStatus(jobId, 'PROCESSING', 'Generando imagen...');
                        const infographicBrief = await generateInfographicBrief(question, language || 'Spanish');
                        const imagePrompt = `Create a ${styleId || 'realistic'} educational image explaining: "${question}". \n\nContent: ${infographicBrief}`;
                        const { mediaUrl: base64Image, mimeType } = await generateImage(imagePrompt, 'nano-banana', aspectRatio || '3:4');
                        const secureUrl = await uploadImage(base64Image, 'nutonia-images');
                        const { text: explanation, groundingMetadata } = await generateTextExplanation(question, profile, document, language || 'Spanish');
                        
                        result = {
                            topic: question,
                            mediaUrl: secureUrl,
                            mediaType: 'IMAGE',
                            mimeType,
                            textSummary: explanation,
                            groundingMetadata: { ...groundingMetadata, profileType: profile.type, profileTitle: profile.title }
                        };
                    } else if (profile.type === 'VIDEO_PRODUCTION') {
                        const rawResult = await videoProductionService.produceVideo(question, 2, voiceStyle || 'Puck', styleId || 'Cinematic', musicStyle?.name || 'Documentary', 'Spanish', aspectRatio, (msg) => updateJobStatus(jobId, 'PROCESSING', msg));
                        const parsedResult = JSON.parse(rawResult);
                        result = { topic: question, mediaUrl: parsedResult.mediaUrl, mediaType: 'VIDEO_PLAYLIST', mimeType: 'application/json', textSummary: "Video generado con Nutonia", groundingMetadata: { profileType: profile.type, profileTitle: profile.title } };
                    } else {
                        throw new Error(`Unsupported profile type: ${profile.type}`);
                    }

                    // Common finalization logic
                    if (!result.mediaUrl) throw new Error("Error: No se pudo obtener la URL del medio generado.");
                    
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
                    
                    await updateJobStatus(jobId, 'COMPLETED', 'Generación completada', { contentId: savedContent.id, ...result });
                    return result;

                } catch (error: any) {
                    console.error(`Job ${jobId} failed: `, error);
                    await updateJobStatus(jobId, 'FAILED', `Error: ${error.message}`);
                    throw error;
                }
            },
            {
                connection: {
                    host: redis.options.host,
                    port: redis.options.port,
                    password: redis.options.password,
                    tls: redis.options.tls,
                    maxRetriesPerRequest: null
                },
                concurrency: 2, 
            }
        );
        
        contentWorker.on('active', (job: any) => console.log(`Worker active: Job ${job.id} started`));
        contentWorker.on('completed', (job: any) => console.log(`✓ Job ${job.id} completed`));
        contentWorker.on('failed', (job: any, error: any) => console.error(`✗ Job ${job?.id} failed: `, error));
        contentWorker.on('error', (error: any) => console.error('Worker error:', error.message));

    } catch (e: any) {
        console.error('Failed to initialize content worker:', e.message);
    }
}

/**
 * Update job status in Redis
 */
async function updateJobStatus(jobId: string, status: string, message?: string, result?: any): Promise<void> {
    if (redisStatus === 'OFFLINE') return;
    const jobKey = `job:${jobId}`;
    try {
        const existingData = await redis.get(jobKey);
        if (!existingData) return;
        const jobData = JSON.parse(existingData);
        await redis.set(jobKey, JSON.stringify({ ...jobData, status, message, result, updatedAt: new Date().toISOString() }), 'EX', 3600);
    } catch (e) {
        console.warn('Failed to update job status in Redis:', e);
    }
}

/**
 * Deduct credits from user
 */
async function deductCredits(userId: string, amount: number): Promise<void> {
    const { data, error } = await supabaseAdmin.rpc('decrement_credits', { user_id: userId, amount });
    if (error || !data) throw new Error('Failed to deduct credits');
    await supabaseAdmin.from('credit_transactions').insert({ user_id: userId, amount: -amount, type: 'SPEND', description: 'Content generation' });
}

console.log('✓ Queue service initialized (Redis status:', redisStatus, ')');
export default contentQueue;
