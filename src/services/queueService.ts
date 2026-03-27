
import { Queue, Worker, Job } from 'bullmq';
import redis from '../config/redis.js';
import { supabaseAdmin } from '../config/supabase.js';
import { generateLyrics, generateImage, generateTextExplanation, generatePresentation, generateInfographicBrief, generateMiniGame, generateInteractiveWeb } from './geminiService.js';
import { generateSongWithSuno } from './sunoService.js';
import { uploadImage } from './storageService.js';
import { analyzePrompt, checkUserViolations, recordViolation } from './moderationService.js';
import { videoProductionService } from './VideoProductionService.js';

// Queue for content generation jobs
export const contentQueue = new Queue('content-generation', {
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

contentQueue.on('error', (err) => {
    console.error('Queue error:', err);
});

// Debug: Log queue status on startup
// Debug: Log queue status on startup
contentQueue.getJobCounts().catch(() => {
    console.warn('⚠️ Could not fetch queue counts on startup. Redis might be down.');
    return null;
}).then(async counts => {
    if (!counts) return;
    console.log('Current Queue Counts:', counts);
    // EMERGENCY CLEAR: If active > 0 on startup, it's stuck.
    if (counts.active > 0 || counts.waiting > 0) {
        console.warn('⚠️ Clearing stuck queue...');
        try {
            await contentQueue.obliterate({ force: true });
            console.log('✓ Queue cleared');
        } catch (e) {
            console.error('Failed to clear queue:', e);
        }
    }
});

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
export const contentWorker = new Worker(
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

            // 2. AI Moderation Check (Pre-generation)
            await updateJobStatus(jobId, 'PROCESSING', 'Verificando contenido...');

            // Combine question and style for context
            const promptToAnalyze = `Tema: ${question}.Estilo: ${profile.title}. ${musicStyle ? `Estilo musical: ${musicStyle.name}` : ''} `;

            const moderationResult = await analyzePrompt(promptToAnalyze, userId);

            if (!moderationResult.isAppropriate) {
                // Record violation
                await recordViolation({
                    userId,
                    violationType: 'INAPPROPRIATE_PROMPT',
                    severity: 'LOW', // Start low, auto-suspend logic handles escalation
                    description: `Prompt rechazado: ${moderationResult.reasoning} `,
                    autoSuspend: true
                });

                throw new Error(`Contenido rechazado por política de moderación: ${moderationResult.reasoning} `);
            }

            // Update job status in Redis
            await updateJobStatus(jobId, 'PROCESSING', 'Iniciando generación...');

            let result: any;

            // Generate based on profile type
            if (profile.type === 'MUSICAL' || profile.type === 'MUSIC_VIDEO') {
                // Audio/Video generation
                await updateJobStatus(jobId, 'PROCESSING', 'Generando letra...');

                const lyricsPrompt = `Crea una letra de canción educativa sobre: "${question}"\n\nEstilo: ${musicStyle?.promptInstruction || 'Música educativa alegre'} \n\nIdioma: ${language || 'Spanish'}\n\nINSTRUCCIONES DE FORMATO(IMPORTANTE): \n - Las indicaciones de estilo(ej: [Verse], [Chorus], [Heavy Bass], [Autotune]) DEBEN ir entre corchetes[].\n - Los sonidos o exclamaciones que SÍ son parte de la letra(ej: (Yeah!), (Oh oh)) DEBEN ir entre paréntesis().\n - El resto del texto será cantado.\n\nLa letra debe explicar el tema de forma clara y pegajosa.`;

                const { text: lyrics, metadata } = await generateLyrics(
                    lyricsPrompt,
                    musicStyle?.name || 'educational',
                    (msg) => updateJobStatus(jobId, 'PROCESSING', msg),
                    document,
                    styleId,
                    language || 'Spanish'
                );

                await updateJobStatus(jobId, 'PROCESSING', 'Generando música y video...');

                const sunoResults = await generateSongWithSuno(
                    lyrics,
                    musicStyle?.sunoTags || 'educational, catchy',
                    question,
                    (msg) => updateJobStatus(jobId, 'PROCESSING', msg),
                    profile.type === 'MUSIC_VIDEO'
                );

                // Use the first result as the main one, but keep all in options
                const mainResult = sunoResults[0];
                const isVideo = profile.type === 'MUSIC_VIDEO' && mainResult.videoUrl;
                const finalMediaUrl = isVideo ? mainResult.videoUrl : mainResult.audioUrl;
                const finalMediaType = isVideo ? 'VIDEO' : 'AUDIO';
                const finalMimeType = isVideo ? 'video/mp4' : 'audio/mpeg';

                result = {
                    topic: question,
                    mediaUrl: finalMediaUrl,
                    mediaType: finalMediaType,
                    mimeType: finalMimeType,
                    textSummary: lyrics,
                    groundingMetadata: {
                        ...metadata,
                        imageUrl: mainResult.imageUrl,
                        profileType: profile.type,
                        profileTitle: profile.title,
                        profileIcon: profile.icon,
                        profileColor: profile.color
                    },
                    options: sunoResults.map((track: any) => {
                        const trackIsVideo = profile.type === 'MUSIC_VIDEO' && track.videoUrl;
                        return {
                            topic: track.title || question,
                            mediaUrl: trackIsVideo ? track.videoUrl : track.audioUrl,
                            mediaType: trackIsVideo ? 'VIDEO' : 'AUDIO',
                            mimeType: trackIsVideo ? 'video/mp4' : 'audio/mpeg',
                            textSummary: lyrics,
                            groundingMetadata: { imageUrl: track.imageUrl }
                        };
                    })
                };
            } else if (profile.mediaType === 'IMAGE') {
                // Image generation
                await updateJobStatus(jobId, 'PROCESSING', 'Generando imagen...');

                // Helper for styles
                const STYLE_DESCRIPTIONS: Record<string, string> = {
                    'realistic': 'Photorealistic, documentary style, high fidelity, 8k',
                    '3d-render': '3D Render, Pixar style, Cinema 4D, clean, modern, cute',
                    'minimalist': 'Minimalist, clean lines, flat colors, no noise',
                    'cyberpunk': 'Cyberpunk, neon, futuristic, dark, high contrast',
                    'watercolor': 'Watercolor painting, soft, artistic, organic textures',
                    'sketch': 'Technical sketch, hand drawn, Da Vinci style, pencil',
                    'anime': 'Anime style, vibrant, Japanese animation',
                    'pixel-art': 'Pixel Art, retro 8-bit video game style',
                    'vintage': 'Vintage, old paper, historical, retro',
                    'comic': 'Comic book style, bold lines, pop colors, Marvel style',
                    'origami': 'Origami, folded paper, geometric, textured',
                    'claymation': 'Claymation, plasticine, stop-motion style, clay textures, handmade look, Play-Doh aesthetic',
                    'neon': 'Neon, bright, dark background, high contrast',
                    'blueprint': 'Blueprint, technical drawing, white lines on blue background',
                    'collage': 'Artistic collage, mixed media, cutouts',
                    'oil-painting': 'Oil painting, visible brushstrokes, textured, classic',
                    'low-poly': 'Low Poly, geometric, polygonal, modern 3d',
                    'steampunk': 'Steampunk, industrial, gears, copper, victorian',
                    'pop-art': 'Pop Art, Andy Warhol style, halftones, bold colors',
                    'abstract': 'Abstract, conceptual, shapes and colors'
                };

                const styleDesc = (styleId && STYLE_DESCRIPTIONS[styleId]) ? STYLE_DESCRIPTIONS[styleId] : (styleId || 'Photorealistic, detailed');

                let formatKeyword = 'Illustration';
                if (profile.type === 'VISUAL') formatKeyword = 'Educational Infographic';
                if (profile.type === 'LOGICAL') formatKeyword = 'Mind Map, Flowchart, Structured Diagram';

                // --- DEEP DIVE LOGIC START ---
                await updateJobStatus(jobId, 'PROCESSING', 'Investigando y estructurando infografía...');
                const infographicBrief = await generateInfographicBrief(question, language || 'Spanish');

                // Construct a style-aware prompt WITH the brief
                const isHandmadeStyle = ['sketch', 'watercolor', 'claymation', 'origami', 'collage', 'vintage', 'pixel-art'].includes(styleId || '');
                const qualityKeywords = isHandmadeStyle ? 'detailed, authentic texture' : 'high-quality, professional composition';

                let structureInstruction = '';
                if (profile.type === 'LOGICAL') {
                    structureInstruction = 'CRITICAL STRUCTURE: This MUST be a central concept connected to branches. IT MUST BE A MIND MAP. Do not make a poster or infographic. A central node with connectors.';
                }

                const imagePrompt = `Create a ${styleDesc} ${formatKeyword} explaining: "${question}".
    Subject: A dense, information-rich visual explanation of "${question}".
    
    VISUAL BRIEF (CONTENT TO INCLUDE):
    ${infographicBrief}
    
    Style Strictness: 10 / 10. The image MUST look like a ${styleId || 'photorealistic image'}.
    Visual Description: ${styleDesc}.
    ${structureInstruction}
    
    TEXT GUIDELINES (CRITICAL):
    - Language: SPANISH ONLY.
    - Typography: Use CLEAR BLOCK LETTERS(Letra de imprenta / molde). AVOID cursive.
    - Content: You perform a Deep Dive. Include the Headers and Key Data Points from the Brief.
    - Legibility: Ensure text is large enough to be read.
    
    Requirements:
    - The image must clearly explain the concept using the structured brief.
    - ${qualityKeywords}.
    - IMPORTANT: Prioritize the Visual Style(${styleDesc}) AND the Structured Content.
    - BRANDING: You MUST Include the text "Nutonia" organically in the design (e.g. as a footer signature, a label, or corner stamp). It must be visible but subtle.`;

                // Calculate Aspect Ratio - Default to 3:4 if not provided, but honor aspectRatio param
                const targetAspectRatio = aspectRatio || '3:4';

                // Use NanoBanana with Explicit Aspect Ratio
                const { mediaUrl: base64Image, mimeType } = await generateImage(imagePrompt, 'nano-banana', targetAspectRatio);

                // Upload to Cloudinary
                await updateJobStatus(jobId, 'PROCESSING', 'Subiendo a la nube...');
                const secureUrl = await uploadImage(base64Image, 'nutonia-images');

                const { text: explanation, groundingMetadata } = await generateTextExplanation(question, profile, document, language || 'Spanish');

                result = {
                    topic: question,
                    mediaUrl: secureUrl, // Now using Cloudinary URL
                    mediaType: 'IMAGE',
                    mimeType,
                    textSummary: explanation,
                    groundingMetadata: {
                        ...groundingMetadata,
                        // Persist profile info for library restoration
                        profileType: profile.type,
                        profileTitle: profile.title,
                        profileIcon: profile.icon,
                        profileColor: profile.color
                    },
                };
            } else if (profile.type === 'PRESENTATION') {
                // Presentation generation
                await updateJobStatus(jobId, 'PROCESSING', 'Diseñando diapositivas...');

                const { text, imageUrl, metadata } = await generatePresentation(question, profile, styleId, language || 'Spanish');

                // Upload cover image
                await updateJobStatus(jobId, 'PROCESSING', 'Subiendo portada...');
                let secureUrl = imageUrl;
                if (imageUrl.startsWith('data:')) {
                    secureUrl = await uploadImage(imageUrl, 'nutonia-images');
                }

                result = {
                    topic: question,
                    mediaUrl: secureUrl,
                    mediaType: 'IMAGE',
                    mimeType: 'image/png', // Shows the cover image as thumbnail
                    textSummary: text, // JSON string
                    groundingMetadata: {
                        ...metadata,
                        profileType: profile.type,
                        profileTitle: profile.title,
                        profileIcon: profile.icon,
                        profileColor: profile.color
                    },
                };
            } else if (profile.type === 'VIDEO_PRODUCTION') {
                // Video Production Logic
                await updateJobStatus(jobId, 'PROCESSING', 'Escribiendo guion y generando escenas...');

                // voiceStyle and styleId are already in scope from job.data destructuring
                const voice = voiceStyle || 'Puck';
                const visual = styleId || 'Cinematic';
                const genre = musicStyle?.name || 'Documentary';

                const rawResult = await videoProductionService.produceVideo(
                    question, 2, voice, visual, genre, 'Spanish', aspectRatio,
                    (msg) => updateJobStatus(jobId, 'PROCESSING', msg)
                );
                const parsedResult = JSON.parse(rawResult);

                result = {
                    topic: question,
                    mediaUrl: parsedResult.mediaUrl, // This is a JSON string of the playlist
                    mediaType: 'VIDEO_PLAYLIST',
                    mimeType: parsedResult.mimeType || 'application/json',
                    textSummary: "Video generado con Nutonia",
                    groundingMetadata: {
                        profileType: profile.type,
                        profileTitle: profile.title,
                        profileIcon: profile.icon,
                        profileColor: profile.color
                    }
                };
            } else if (profile.type === 'MINI_GAME') {
                // Mini Game Generation
                await updateJobStatus(jobId, 'PROCESSING', 'Diseñando mini juego...');

                const { text, imageUrl, metadata } = await generateMiniGame(question, profile, styleId, language || 'Spanish');

                result = {
                    topic: question,
                    mediaUrl: imageUrl, // Cover image
                    mediaType: 'IMAGE',
                    mimeType: 'image/png',
                    textSummary: text, // JSON string with game rules/levels
                    groundingMetadata: {
                        ...metadata,
                        profileType: profile.type,
                        profileTitle: profile.title,
                        profileIcon: profile.icon,
                        profileColor: profile.color
                    }
                };
            } else if (profile.type === 'INTERACTIVE_WEB') {
                // Interactive Web Generation
                await updateJobStatus(jobId, 'PROCESSING', 'Generando web interactiva...');

                const { text, imageUrl, metadata } = await generateInteractiveWeb(question, profile, (msg) => updateJobStatus(jobId, 'PROCESSING', msg), styleId, language || 'Spanish');

                result = {
                    topic: question,
                    mediaUrl: imageUrl, // Cover image for preview
                    mediaType: 'IMAGE', // Shows preview image in library
                    mimeType: 'text/html', // Correct mime type for the player to recognize
                    textSummary: text, // Full HTML source
                    groundingMetadata: {
                        ...metadata,
                        profileType: profile.type,
                        profileTitle: profile.title,
                        profileIcon: profile.icon,
                        profileColor: profile.color
                    }
                };
            } else {
                throw new Error(`Unsupported profile type: ${profile.type} `);
            }

            // Deduct credits
            await deductCredits(userId, 1);

            // Save to database
            await updateJobStatus(jobId, 'PROCESSING', 'Guardando contenido...');

            // DEBUG: Log result if musical
            if (profile.type === 'MUSICAL' || profile.type === 'MUSIC_VIDEO') {
                console.log(`[QueueService] Musical generation result for user ${userId}:`, JSON.stringify(result, null, 2));
            }

            // CRITICAL VALIDATION: Ensure mediaUrl is not null to avoid DB constraint error
            if (!result.mediaUrl) {
                console.error(`[QueueService] FAILED: mediaUrl is null for job ${jobId}. Result:`, JSON.stringify(result));
                throw new Error(`Error: No se pudo obtener la URL del medio generado (${result.mediaType}). Por favor, intenta de nuevo.`);
            }

            const { data: savedContent, error } = await supabaseAdmin.from('content').insert({
                creator_id: userId,
                topic: result.topic,
                media_type: result.mediaType === 'VIDEO_PLAYLIST' ? 'VIDEO' : result.mediaType,
                media_url: result.mediaUrl,
                text_summary: result.textSummary,
                grounding_metadata: result.groundingMetadata,
                is_public: true,
                collection_id: collectionId // Save collection ID!
            }).select().single();

            if (error) {
                console.error(`[QueueService] Supabase insert error for job ${jobId}:`, error);
                throw new Error(`Failed to save content: ${error.message} `);
            }

            // Create Notification (Non-blocking)
            try {
                await supabaseAdmin.from('notifications').insert({
                    user_id: userId,
                    type: 'GENERATION_COMPLETE',
                    title: 'Contenido Listo',
                    message: `Tu contenido sobre "${question}" ha sido generado exitosamente.`,
                    read: false,
                    data: { contentId: savedContent.id }
                });
            } catch (notifError) {
                console.warn("Failed to create completion notification:", notifError);
            }

            // Mark job as complete
            await updateJobStatus(jobId, 'COMPLETED', 'Generación completada', {
                contentId: savedContent.id,
                ...result,
            });

            console.log(`Job ${jobId} completed successfully`);

            return result;
        } catch (error: any) {
            console.error(`Job ${jobId} failed: `, error);
            await updateJobStatus(jobId, 'FAILED', `Error: ${error.message} `);
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
        concurrency: 2, // Process 2 jobs in parallel
    }
);

/**
 * Update job status in Redis
 */
async function updateJobStatus(
    jobId: string,
    status: string,
    message?: string,
    result?: any
): Promise<void> {
    const jobKey = `job:${jobId}`;
    const existingData = await redis.get(jobKey);

    if (!existingData) {
        console.warn(`Job ${jobId} not found in Redis`);
        return;
    }

    const jobData = JSON.parse(existingData);

    await redis.set(
        jobKey,
        JSON.stringify({
            ...jobData,
            status,
            message,
            result,
            ...(status === 'COMPLETED' && { completedAt: new Date().toISOString() }),
            updatedAt: new Date().toISOString(),
        }),
        'EX',
        3600 // 1 hour expiry
    );
}

/**
 * Deduct credits from user
 */
async function deductCredits(userId: string, amount: number): Promise<void> {
    const { data, error } = await supabaseAdmin.rpc('decrement_credits', {
        user_id: userId,
        amount,
    });

    if (error || !data) {
        throw new Error('Failed to deduct credits');
    }

    // Log transaction
    await supabaseAdmin.from('credit_transactions').insert({
        user_id: userId,
        amount: -amount,
        type: 'SPEND',
        description: 'Content generation',
    });
}

// Worker event handlers
contentWorker.on('active', (job) => {
    console.log(`Worker active: Job ${job.id} started processing`);
});

contentWorker.on('completed', (job) => {
    console.log(`✓ Job ${job.id} completed`);
});

contentWorker.on('failed', (job, error) => {
    console.error(`✗ Job ${job?.id} failed: `, error);
});

contentWorker.on('error', (error) => {
    console.error('Worker error:', error);
});

console.log('✓ Content generation worker started');
console.log('Worker connection status:', redis.status);

export default contentQueue;
