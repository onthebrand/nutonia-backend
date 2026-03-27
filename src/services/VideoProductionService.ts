import { generateVideo, generateImage, generateTextExplanation } from './geminiService';
import { textToSpeechService } from './TextToSpeechService';
import sunoService from './sunoService'; // Assuming this exists
import storageService from './storageService';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

// Types
interface VideoScene {
    type: 'VIDEO' | 'IMAGE';
    prompt: string;
    duration: number; // seconds
    mediaUrl?: string; // Populated after generation
}

interface VideoScript {
    title: string;
    scenes: {
        narration: string;
        visualPrompt: string;
        visualType: 'VIDEO' | 'IMAGE';
        estimatedDuration: number;
    }[];
    characterDescription?: string; // For consistency
}

export const videoProductionService = {

    async produceVideo(topic: string, durationMinutes: number = 2, voiceStyle: string = 'Puck', visualStyle: string = 'Cinematic', genre: string = 'Documentary', language: string = 'Spanish', aspectRatio: string = '16:9', onProgress?: (msg: string) => void): Promise<string> {
        console.log(`Starting video production for: ${topic} (${durationMinutes} min) with Voice: ${voiceStyle}, Visual: ${visualStyle}, Genre: ${genre}, Language: ${language}, Aspect: ${aspectRatio}`);
        if (onProgress) onProgress("Escribiendo guion cinematográfico...");

        // Map voice style to ElevenLabs Voice ID
        const voiceMap: Record<string, string> = {
            'Puck': '21m00Tcm4TlvDq8ikWAM', // Rachel (Default)
            'Bella': 'EXAVITQu4vr4xnSDxMaL', // Bella
            'Adam': 'pNInz6obpgDQGcFmaJgB', // Adam
            'Antoni': 'ErXwobaYiN019PkySvjV', // Antoni
            'Josh': 'TxGEqnHWrfWFTfGW9XjX', // Josh
            'Arnold': 'VR6AewLTigWg4xSOukaG', // Arnold
            'Domi': 'AZnzlk1XvdvUeBnXmlld', // Domi
            'Elli': 'MF3mGyEYCl7XYWbV9V6O', // Elli
            'Sam': 'yoZ06aMxZJJ28mfd3POQ' // Sam
        };
        const voiceId = voiceMap[voiceStyle] || '21m00Tcm4TlvDq8ikWAM';

        // 1. Generate Script
        // We will generate a script for approx 1-2 minutes.
        const script = await this.generateScript(topic, durationMinutes, visualStyle, genre, language, aspectRatio);
        console.log(`Script generated with ${script.scenes.length} scenes.`);
        if (onProgress) onProgress(`Guion listo: ${script.scenes.length} escenas. Generando assets...`);

        // 2. Generate Assets (Sequential to avoid rate limits)
        // 2. Generate Assets (Sequential to avoid rate limits and errors with high-end Video models)
        const assets: any[] = new Array(script.scenes.length).fill(null);
        const BATCH_SIZE = 1; // Strict sequential processing for Veo
        let quotaExceeded = false; // Track if we hit a quota limit

        for (let i = 0; i < script.scenes.length; i += BATCH_SIZE) {
            const batch = script.scenes.slice(i, i + BATCH_SIZE);
            console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(script.scenes.length / BATCH_SIZE)}...`);

            await Promise.all(batch.map(async (scene, batchIdx) => {
                const globalIndex = i + batchIdx;
                console.log(`Generating assets for scene ${globalIndex + 1}/${script.scenes.length}...`);
                if (onProgress) onProgress(`Generando escena ${globalIndex + 1} de ${script.scenes.length}...`);

                let audioUrl = '';
                let visualUrl = '';

                try {
                    // a. Audio (TTS)
                    const ttsResult = await textToSpeechService.generateSpeech(scene.narration, { provider: 'elevenlabs', voiceId });
                    audioUrl = ttsResult.audioUrl;

                    if (audioUrl) {
                        try {
                            audioUrl = await storageService.uploadVideo(audioUrl, 'nutonia-audio');
                        } catch (e) {
                            console.error("Failed to upload audio to Cloudinary", e);
                            // Fallback to local URL
                            const fileName = path.basename(audioUrl);
                            audioUrl = `/temp/${fileName}`;
                        }
                    }

                    // b. Visual (Veo or Image)
                    let finalPrompt = scene.visualPrompt;
                    if (script.characterDescription) {
                        finalPrompt = `Characterdescription: ${script.characterDescription}. Action: ${finalPrompt}`;
                    }
                    const styledPrompt = `${finalPrompt}. Style: ${visualStyle}. Genre Mood: ${genre}. Aspect Ratio: ${aspectRatio}. High quality, detailed, 4k.`;

                    if (scene.visualType === 'VIDEO') {
                        try {
                            const videoResult = await generateVideo(styledPrompt, 'veo-2.0-generate-001');
                            visualUrl = videoResult.mediaUrl;
                        } catch (videoError: any) {
                            console.error("Video generation failed, falling back to Image:", videoError);

                            // Check for Quota Exceeded (429)
                            if (videoError.code === 429 || videoError.status === 429 || videoError.message?.includes('429') || videoError.message?.includes('quota')) {
                                quotaExceeded = true;
                            }

                            // FALLBACK TO IMAGE
                            try {
                                const imageResult = await generateImage(styledPrompt, 'gemini-3-pro-image-preview');
                                visualUrl = imageResult.mediaUrl;
                                scene.visualType = 'IMAGE'; // Update mutable scene object so playlist knows it's an image

                                if (visualUrl && !visualUrl.startsWith('http')) {
                                    visualUrl = await storageService.uploadImage(visualUrl, 'nutonia-visuals');
                                }
                            } catch (imgError) {
                                console.error("Fallback image generation also failed:", imgError);
                            }
                        }
                    } else {
                        const imageResult = await generateImage(styledPrompt, 'gemini-3-pro-image-preview');
                        visualUrl = imageResult.mediaUrl;
                        try {
                            if (visualUrl && !visualUrl.startsWith('http')) {
                                visualUrl = await storageService.uploadImage(visualUrl, 'nutonia-visuals');
                            }
                        } catch (e) {
                            console.error("Failed to upload image to Cloudinary", e);
                        }
                    }

                    assets[globalIndex] = {
                        index: globalIndex,
                        audioPath: audioUrl,
                        visualPath: visualUrl,
                        duration: scene.estimatedDuration
                    };
                } catch (error) {
                    console.error(`Error generating assets for scene ${globalIndex}:`, error);
                    // Fallback for failed scene to prevent total failure, using whatever we managed to generate
                    assets[globalIndex] = {
                        index: globalIndex,
                        audioPath: audioUrl || '', // Use partial result
                        visualPath: visualUrl || '', // Use partial result
                        duration: scene.estimatedDuration
                    };
                }
            }));
        }
        console.log('All assets generated.');

        // 3. Generate Background Music
        let music = "";
        try {
            music = await sunoService.generateBackgroundMusic(topic, `${genre}, cinematic, background music`);
        } catch (e) {
            console.warn("Background music generation failed, continuing without it.");
        }

        // 4. Stitching (Mock for now, as Cloudinary stitching is complex to implement without verified keys/SDK setup in this turn)
        // In a real implementation, we would upload all assets to Cloudinary and use their video concatenation API.
        // For now, we will return a manifest or a simple playlist, or just the first video clip as a demo.

        // Let's try to "stitch" by creating a simple HTML/JSON playlist that the frontend can play sequentially?
        // Or better, if we have ffmpeg on the server (unlikely in this env without checking), we could use fluent-ffmpeg.

        // Given the constraints and the "integrated" request, I will assume the frontend will handle the "stitching" playback 
        // if I return a structured object, OR I can try to use a cloud service.

        // 5. Notification
        // Assuming we have a NotificationService or can update the item status to trigger one
        // ideally we would emit an event, but here we can just log for now or ensure the status update does it.
        // The calling controller usually handles the "READY" status update which should trigger notification.
        // We will return the result.

        return JSON.stringify({
            topic: topic,
            mediaUrl: JSON.stringify({
                title: script.title,
                backgroundMusic: music,
                warnings: quotaExceeded ? ["Se ha excedido la cuota de generación de video. Se han generado imágenes en su lugar."] : [],
                playlist: assets.map(a => ({
                    type: script.scenes[a.index] && script.scenes[a.index].visualType === 'VIDEO' ? 'video' : 'image', // This might need adjustment if we fallback
                    src: a.visualPath,
                    audioSrc: a.audioPath,
                    duration: a.duration
                }))
            }),
            mediaType: 'VIDEO_PLAYLIST',
            mimeType: 'application/json'
        });
    },

    async generateScript(topic: string, durationMinutes: number, visualStyle: string = 'Cinematic', genre: string = 'Documentary', language: string = 'Spanish', aspectRatio: string = '16:9'): Promise<VideoScript> {
        // Mock script generation for now, or call Gemini
        // Calling Gemini for real script
        const prompt = `Create a NARRATIVE video script for a ${durationMinutes}-minute educational video about "${topic}".
    
    CRITICAL INSTRUCTION: This must feel like a "${genre}" film/series episode.
    TARGET DURATION: ${durationMinutes} minutes (Approx 250-300 words).

    VISUAL STRATEGY (VIDEO FIRST):
    - Act like a Film Director. Use VIDEO for MOST scenes.
    - Ratio: Use "VIDEO" for 80-90% of scenes. Only use "IMAGE" for static diagrams or title cards.
    - Pacing: "VIDEO" scenes should be 5-6s.
    
    Structure:
    {
      "title": "Video Title",
      "characterDescription": "MANDATORY: Detailed visual description of the main presenter/character. This description will be used in EVERY scene to ensure visual consistency (e.g. 'A futuristic robot with glowing blue eyes', 'A detective in a trench coat').",
      "scenes": [
        {
          "narration": "Script line for this scene. Language: ${language}. Keep it engaging and fitting the ${genre} tone.",
          "visualPrompt": "Detailed prompt for video generation api (describe the action, setting, lighting, and camera angle). MUST INCLUDE the character description if applicable. Atmosphere: ${genre}. Style: ${visualStyle}.",
          "visualType": "VIDEO" (preferred for action) or "IMAGE" (for static details),
          "estimatedDuration": 4 (seconds, range 3-6)
        }
      ]
    }
    
    NARRATIVE ARC REQUIREMENTS:
    1. INTRO: Hook the viewer immediately using the ${genre} style.
    2. DEVELOPMENT: deep dive into ${topic}.
    3. CONCLUSION: Strong takeaway.
    
    Ensure scenes cover the whole duration. FAST PACED: Create many short scenes (4-6s) to keep the video dynamic.`;

        // We use generateTextExplanation as a raw text generator for now
        const response = await generateTextExplanation(prompt, { title: 'Script Gen', description: 'Script', formatDescription: 'JSON' }, undefined, language);

        try {
            // Extract JSON from response
            const jsonMatch = response.text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            throw new Error("No JSON found");
        } catch (e) {
            console.error("Failed to parse script JSON", e);
            // Fallback script
            return {
                title: topic,
                scenes: [
                    {
                        narration: `Welcome to this explanation of ${topic}.`,
                        visualPrompt: `Intro title card for ${topic}`,
                        visualType: "IMAGE",
                        estimatedDuration: 5
                    },
                    {
                        narration: `${topic} is a fascinating subject that affects our daily lives.`,
                        visualPrompt: `Cinematic shot representing ${topic}`,
                        visualType: "VIDEO",
                        estimatedDuration: 6
                    }
                ]
            };
        }
    }
};
