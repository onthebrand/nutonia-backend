import { env } from '../config/env.js';
import storageService from './storageService.js';

// Suno API configuration
const SUNO_API_BASE_URL = 'https://api.sunoapi.org/api/v1';

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

/**
 * Generate song with Suno API
 */


// Correct implementation of generateSongWithSuno
export async function generateSongWithSuno(
    lyrics: string,
    tags: string,
    topic: string,
    onProgress?: (message: string) => void,
    makeVideo: boolean = false,
    isInstrumental: boolean = false
): Promise<any[]> {
    console.log("DEBUG: generateSongWithSuno CALLED with V3_5 fix");
    const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.SUNO_API_KEY}`,
    };

    try {
        console.log(`DEBUG: generateSongWithSuno - Lyrics length: ${lyrics?.length || 0}`);
        const title = `Tema: ${topic}`.substring(0, 80);
        const safeLyrics = lyrics.length > 3000 ? lyrics.substring(0, 2990) + '...' : lyrics;

        if (onProgress) onProgress('Enviando letra al servicio de música...');

        const body: any = {
            customMode: true,
            prompt: safeLyrics,
            style: tags || 'pop',
            model: 'V3_5', // Correct model enum from validation
            title,
            instrumental: isInstrumental,
            callBackUrl: 'https://nutonia-api.vercel.app/api/webhook/suno',
        };

        console.log('Suno Request Body (Audio):', JSON.stringify(body, null, 2));

        // 1. Create generation task (AUDIO)
        const generateResponse = await fetch(`${SUNO_API_BASE_URL}/generate`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });

        const generateResult: any = await generateResponse.json();
        const resultCode = generateResult.code || generateResponse.status;

        console.log('Suno API Response (Audio):', JSON.stringify(generateResult, null, 2));

        if (!generateResponse.ok || (resultCode && resultCode !== 200)) {
            throw new Error(`Music Service Error: ${generateResult.msg || generateResult.message || 'Unknown error'} (Code: ${resultCode})`);
        }

        const taskId = generateResult?.data?.taskId || generateResult?.data?.task_id || generateResult?.id;

        if (!taskId) {
            throw new Error(`No Task ID returned from Suno. Full response: ${JSON.stringify(generateResult)}`);
        }

        if (onProgress) onProgress('Procesando audio (esto puede tomar 1-2 minutos)...');

        // 2. Poll for AUDIO completion
        const maxAttempts = 30;
        let delayMs = 3000;
        let audioTracks: any[] = [];

        for (let i = 0; i < maxAttempts; i++) {
            await delay(delayMs);

            // Exponential backoff
            if (i === 1) delayMs = 3000;
            else if (i === 2) delayMs = 5000;
            else if (i === 4) delayMs = 7000;
            else if (i === 5) delayMs = 10000;

            try {
                const pollUrl = `${SUNO_API_BASE_URL}/generate/record-info?taskId=${taskId}`;
                const pollResponse = await fetch(pollUrl, { method: 'GET', headers });

                if (!pollResponse.ok) continue;

                const pollData: any = await pollResponse.json();
                const dataRoot = pollData.data || pollData;
                const status = dataRoot.status;

                console.log(`Suno Audio Poll ${i + 1}: ${status}`);

                // Check for data presence even if status is not strictly 'SUCCESS' (e.g. 'FIRST_SUCCESS')
                // Robust sunoData detection
                const internalResponse = dataRoot.response;
                const sunoData = (internalResponse?.sunoData || dataRoot.sunoData || dataRoot.data);

                if (status === 'SUCCESS' || (sunoData && Array.isArray(sunoData) && sunoData.length > 0)) {
                    console.log(`Suno data found (Status: ${status}), checking for valid tracks...`);

                    if (sunoData && Array.isArray(sunoData) && sunoData.length > 0) {
                        // Check if ALL tracks have an audio URL if they are present
                        const allTracksHaveUrl = sunoData.every((t: any) =>
                            t.audioUrl || t.audio_url || t.url || t.cdn_url || t.stream_url || t.audio || t.file_url || t.play_url
                        );

                        if (allTracksHaveUrl || (status === 'SUCCESS' && i > 10)) {
                            audioTracks = sunoData;
                            console.log(`✓ All ${sunoData.length} tracks have URLs or timeout reached with SUCCESS status.`);
                            break;
                        } else {
                            console.log(`Suno data found but some tracks missing URLs (${sunoData.filter((t: any) => !(t.audioUrl || t.audio_url || t.url || t.cdn_url || t.stream_url || t.audio)).length} missing), continuing to poll...`);
                        }
                    }
                }

                if (status === 'FAILED' || status === 'ERROR') {
                    throw new Error(`Suno generation failed with status: ${status}`);
                }
            } catch (pollError: any) {
                console.error(`Poll attempt ${i + 1} error:`, pollError);
                if (i === maxAttempts - 1) throw pollError;
            }
        }

        if (audioTracks.length === 0) {
            throw new Error('Timeout waiting for audio generation');
        }

        // 3. If Video requested, generate video for the first track
        if (makeVideo) {
            if (onProgress) onProgress('Generando video musical (esto toma 1-2 minutos extra)...');

            // Process tracks sequentially or simply pick the first one to save time/credits
            // Usually users want the video for the best version, but we don't know which one is best.
            // We will generate video for ALL tracks.

            const resultsWithVideo = await Promise.all(audioTracks.map(async (track: any) => {
                try {
                    const audioId = track.id; // Correct ID field for track
                    console.log(`Starting video generation for track ${audioId} (Task: ${taskId})`);

                    const videoBody = {
                        taskId: taskId, // Original task ID
                        audioId: audioId,
                        callBackUrl: 'https://nutonia-api.vercel.app/api/webhook/suno',
                    };

                    const videoResponse = await fetch(`${SUNO_API_BASE_URL}/mp4/generate`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify(videoBody)
                    });

                    const videoResult: any = await videoResponse.json();
                    console.log('Video Generation Response:', JSON.stringify(videoResult, null, 2));

                    if (videoResult.code !== 200) {
                        console.warn(`Video generation failed for track ${audioId}: ${videoResult.msg}`);
                        const audioUrl = track.audioUrl || track.audio_url || track.url || track.cdn_url || track.stream_url || track.audio || track.file_url;
                        const imageUrl = track.imageUrl || track.image_url || track.image_cdn_url || track.cover_url;

                        if (!audioUrl) {
                            console.error(`CRITICAL: No audio URL found for track ${audioId}. Full track data:`, JSON.stringify(track));
                        }

                        return {
                            audioUrl: audioUrl,
                            imageUrl: imageUrl,
                            title: track.title,
                            duration: track.duration,
                            videoUrl: null // Failed video
                        };
                    }

                    const videoTaskId = videoResult.data?.taskId;

                    // Poll for VIDEO completion
                    let videoUrl = null;
                    const vMaxAttempts = 30;
                    const vDelay = 3000;

                    for (let k = 0; k < vMaxAttempts; k++) {
                        await delay(vDelay);
                        const actualPollId = videoTaskId || taskId;
                        const vPollResponse = await fetch(`${SUNO_API_BASE_URL}/mp4/record-info?taskId=${actualPollId}`, { method: 'GET', headers });
                        if (!vPollResponse.ok) continue;

                        const vPollData: any = await vPollResponse.json();
                        const vData = vPollData.data;
                        if (vData && vData.successFlag === 'SUCCESS') {
                            videoUrl = vData.response?.videoUrl || vData.response?.url || vData.response?.video_url || vData.videoUrl || vData.url;
                            break;
                        } else if (vData && (vData.successFlag === 'GENERATE_MP4_FAILED' || vData.successFlag === 'CREATE_TASK_FAILED')) {
                            console.warn(`Suno video polling failed for track ${audioId} with flag: ${vData.successFlag}`);
                            break; // Failed
                        }
                    }

                    let finalAudioUrl = track.audioUrl || track.audio_url || track.url || track.cdn_url || track.stream_url || track.audio || track.file_url;
                    let finalImageUrl = track.imageUrl || track.image_url || track.image_cdn_url || track.cover_url;

                    if (!finalAudioUrl) {
                        console.error(`CRITICAL: No audio URL found for track ${audioId} after video attempt. Full track data:`, JSON.stringify(track));
                    } else {
                        try {
                            if (onProgress) onProgress('Guardando audio en la nube...');
                            finalAudioUrl = await storageService.uploadVideo(finalAudioUrl, 'nutonia-audio');
                        } catch (e) {
                            console.error("Failed to upload Suno audio to Cloudinary, using original:", e);
                        }
                    }

                    if (finalImageUrl) {
                        try {
                            finalImageUrl = await storageService.uploadImage(finalImageUrl, 'nutonia-images');
                        } catch (e) { }
                    }

                    return {
                        audioUrl: finalAudioUrl,
                        imageUrl: finalImageUrl,
                        title: track.title,
                        duration: track.duration,
                        videoUrl: videoUrl // Could be null
                    };

                } catch (e) {
                    console.error("Error generating video for track:", e);
                    let audioUrl = track.audioUrl || track.audio_url || track.url || track.cdn_url || track.stream_url || track.audio || track.file_url;
                    let imageUrl = track.imageUrl || track.image_url || track.image_cdn_url || track.cover_url;

                    try {
                        if (audioUrl) audioUrl = await storageService.uploadVideo(audioUrl, 'nutonia-audio');
                    } catch (err) { }
                    try {
                        if (imageUrl) imageUrl = await storageService.uploadImage(imageUrl, 'nutonia-images');
                    } catch (err) { }

                    return {
                        audioUrl: audioUrl,
                        imageUrl: imageUrl,
                        title: track.title,
                        duration: track.duration,
                        videoUrl: null
                    };
                }
            }));

            if (onProgress) onProgress(`✓ ${resultsWithVideo.length} videos procesados`);
            return resultsWithVideo;

        } else {
            // Just Audio
            const rawResults = audioTracks.map((track: any) => {
                const audioUrl = track.audioUrl || track.audio_url || track.url || track.cdn_url || track.stream_url || track.audio || track.file_url || track.play_url;
                const imageUrl = track.imageUrl || track.image_url || track.image_cdn_url || track.cover_url;

                if (!audioUrl) {
                    console.error(`CRITICAL: No audio URL found for track ${track.id || 'unknown'}. Full track data:`, JSON.stringify(track));
                }

                return {
                    audioUrl: audioUrl,
                    videoUrl: null,
                    imageUrl: imageUrl,
                    title: track.title,
                    duration: track.duration
                };
            }).filter((r: any) => r.audioUrl); // filter out tracks that still failed to get a URL

            // Upload valid tracks to Cloudinary
            const results = await Promise.all(rawResults.map(async (r: any) => {
                let finalAudioUrl = r.audioUrl;
                let finalImageUrl = r.imageUrl;

                try {
                    if (onProgress) onProgress(`Guardando pista en la nube...`);
                    finalAudioUrl = await storageService.uploadVideo(r.audioUrl, 'nutonia-audio');
                } catch (e) {
                    console.error("Failed to upload audio to Cloudinary, using original URL", e);
                }

                try {
                    if (r.imageUrl) {
                        finalImageUrl = await storageService.uploadImage(r.imageUrl, 'nutonia-images');
                    }
                } catch (e) {
                    console.error("Failed to upload image to Cloudinary", e);
                }

                return {
                    ...r,
                    audioUrl: finalAudioUrl,
                    imageUrl: finalImageUrl
                };
            }));

            if (onProgress) onProgress(`✓ ${results.length} audios preservados exitosamente`);
            return results;
        }

    } catch (error: any) {
        console.error('Suno generation error:', error);
        throw new Error(`Music generation failed: ${error.message}`);
    }
}

export async function generateBackgroundMusic(topic: string, style: string): Promise<string> {
    try {
        console.log(`Generating background music for: ${topic} with style: ${style}`);
        const results = await generateSongWithSuno(
            "[Instrumental]",
            style,
            topic,
            undefined,
            false,
            true // Instrumental
        );
        return results[0]?.audioUrl || "";
    } catch (e) {
        console.error("Background music generation failed", e);
        return "";
    }
}

export default {
    generateSongWithSuno,
    generateBackgroundMusic
};
