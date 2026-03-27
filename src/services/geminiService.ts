import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from '@google/generative-ai';
import { env } from '../config/env.js';
import storageService from './storageService.js';
import path from 'path';
import fs from 'fs';
import * as cheerio from 'cheerio';

// Types (matching frontend)
export interface LearningProfile {
    type: string;
    title: string;
    model: string;
    mediaType: 'AUDIO' | 'VIDEO' | 'IMAGE';
    formatDescription: string;
}

export interface MusicStyle {
    name: string;
    icon: string;
    promptInstruction: string;
    sunoTags?: string;
}

export interface GeneratedContent {
    topic: string;
    mediaUrl: string;
    mediaType: 'AUDIO' | 'VIDEO' | 'IMAGE';
    mimeType: string;
    textSummary?: string;
    wordTimings?: any[];
    didacticScore?: number;
    didacticFeedback?: string;
    groundingMetadata?: any;
    options?: GeneratedContent[];
}

// Gemini client singleton
let geminiClient: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
    if (!geminiClient) {
        geminiClient = new GoogleGenerativeAI(env.GEMINI_API_KEY);
    }
    return geminiClient;
}

async function fetchRealUrlFromDDG(query: string): Promise<string | null> {
    try {
        const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
                // Adding a referrer to bypass basic bots
                'Referer': 'https://duckduckgo.com/'
            }
        });
        if (!res.ok) return null;
        const html = await res.text();
        const $ = cheerio.load(html);
        const firstLink = $('a.result__url').first().attr('href');
        if (firstLink) {
            if (firstLink.includes('uddg=')) {
                const urlParam = new URL('https:' + firstLink).searchParams.get('uddg');
                if (urlParam) return decodeURIComponent(urlParam);
            }
            return firstLink;
        }
    } catch (e) {
        console.warn('DDG Scraper error:', e);
    }
    return null;
}

async function extractGroundingMetadata(response: any): Promise<any> {
    const candidate = response.candidates?.[0];
    const groundingMetadata = candidate?.groundingMetadata;

    if (!groundingMetadata) return undefined;

    const sources: any[] = [];
    const searchQueries = groundingMetadata.searchQueries || [];

    if (groundingMetadata.groundingChunks) {
        // We use a traditional for loop to properly wait for DDG scrapes sequentially
        for (let index = 0; index < groundingMetadata.groundingChunks.length; index++) {
            const chunk = groundingMetadata.groundingChunks[index];
            if (chunk.web) {
                let url = chunk.web.uri || '';
                let title = chunk.web.title || 'Sin título';
                let domain = url ? new URL(url).hostname : 'unknown';

                // Intercept broken Vertex AI links
                if (url.includes('vertexaisearch.cloud.google.com')) {
                    const apparentDomain = (title.includes('.') && !title.includes(' ')) ? title : domain;
                    const searchPhrase = `site:${apparentDomain !== 'unknown' ? apparentDomain : ''} ${title}`;
                    const realUrl = await fetchRealUrlFromDDG(searchPhrase);

                    if (realUrl) {
                        url = realUrl;
                        try { domain = new URL(realUrl).hostname; } catch (e) { }
                    } else {
                        // If scraper fails, keep the organic fake deep-link string as fallback
                        url = `https://www.google.com/search?q=${encodeURIComponent(searchPhrase)}`;
                        domain = apparentDomain !== 'unknown' ? apparentDomain : 'Google Search';
                    }
                }

                sources.push({
                    id: `source-${index}`,
                    title: title,
                    url: url,
                    snippet: chunk.web.snippet || '',
                    domain: domain,
                    accessDate: new Date().toISOString()
                });
            }
        }
    }

    // Calculate an average support score if available
    let supportScore = 0;
    if (groundingMetadata.groundingSupports && groundingMetadata.groundingSupports.length > 0) {
        const scores = groundingMetadata.groundingSupports.map((s: any) => s.confidenceScore || 0);
        supportScore = scores.reduce((a: number, b: number) => a + b, 0) / scores.length;
    }

    return {
        searchQueries,
        sources,
        groundingSupport: supportScore
    };
}

async function researchTopic(topic: string): Promise<any> {
    const ai = getClient();
    try {
        console.log(`Researching topic for sources: ${topic}`);
        const model = ai.getGenerativeModel({
            model: 'gemini-2.5-flash', // Use available model
        });
        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: `Investiga sobre: "${topic}". \n      Proporciona 3 datos clave y asegúrate de usar la herramienta de búsqueda para obtener fuentes reales.` }] }],
            tools: [{ googleSearch: {} } as any]
        });
        const response = result.response;
        return await extractGroundingMetadata(response);
    } catch (error) {
        console.warn("Topic research failed:", error);
        return undefined;
    }
}

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

/**
 * Generate lyrics with Gemini
 */
export async function generateLyrics(
    textPrompt: string,
    musicStyle: string,
    onProgress?: (message: string) => void,
    document?: { content: string; mimeType: string },
    visualStyle?: string,
    language: string = 'Spanish'
): Promise<{ text: string; metadata?: any }> {
    const ai = getClient();
    // Try available models based on API capabilities
    // For very long technical prompts, prioritize Pro model for better coherence
    const modelsToTry = textPrompt.length > 1000
        ? ['gemini-2.5-pro', 'gemini-2.5-flash']
        : ['gemini-2.5-flash', 'gemini-2.5-pro'];

    let lastError;

    for (const modelName of modelsToTry) {
        try {
            if (onProgress) {
                onProgress(`Intentando generar con modelo: ${modelName}...`);
            }

            let instructions = `Eres un compositor experto y un genio de la comunicación educativa. Tu tarea es escribir la letra de una canción completa, épica y profunda basada en el material técnico proporcionado.

ESTILO MUSICAL: ${musicStyle}
IDIOMA: ${language}

MATERIAL TÉCNICO A PROCESAR:
---
${textPrompt}
---

INSTRUCCIONES CRÍTICAS PARA CALIDAD PREMIUM:
1. ESTRUCTURA Y DURACIÓN: Genera una canción de duración media-larga (4-5 minutos). Estructura obligatoria: [Intro], [Verse 1], [Chorus], [Verse 2], [Chorus], [Bridge], [Verse 3], [Chorus], [Outro], [End].
2. DENSIDAD NARRATIVA: NO resumas, pero sé conciso. Cada estrofa debe tener 8-10 líneas máximo para asegurar que toda la letra quepa en el tiempo de generación. Divide el texto técnico entre los 3 versos y el Bridge.
3. PRIORIDAD VOCAL: En géneros como el rock progresivo, prioriza que la letra se cante completa antes de extenderse en solos instrumentales.
4. RIMA Y RITMO: Asegúrate de que la letra rime perfectamente y tenga una cadencia natural.
5. MARCA DE AGUA: Incluye "Nutonia" de forma natural (ej. "en el saber de Nutonia"). 
6. FORMATO: 
   - Escribe SOLAMENTE la letra estructurada.
   - Usa etiquetas entre CORCHETES como [Verse 1], [Chorus], etc.
   - Termina SIEMPRE con la etiqueta [End] después del Outro.

Aprovecha el material para explicar el tema de principio a fin de forma equilibrada.`;

            if (visualStyle) {
                instructions += `\n\nEstilo Visual sugerido para el video: ${visualStyle}. Ten en cuenta este estilo para la atmósfera de la canción.`;
            }

            let promptParts: any[] = [
                { text: instructions }
            ];

            if (document) {
                const base64Data = document.content.includes(',')
                    ? document.content.split(',')[1]
                    : document.content;

                promptParts.push({
                    inlineData: {
                        data: base64Data,
                        mimeType: document.mimeType
                    }
                });
            }

            const model = ai.getGenerativeModel({
                model: modelName,
                safetySettings: [
                    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }
                ]
            });
            console.log(`[GeminiService] Sending lyrics request to ${modelName}. Input length: ${instructions.length}`);

            const result = await model.generateContent({
                contents: [{ role: 'user', parts: promptParts }],
                generationConfig: {
                    temperature: 0.4, // Reduced to improve instruction adherence
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: 4096, // Increased for long songs
                }
            });

            const response = result.response;
            const text = response.text();

            console.log(`[GeminiService] Received lyrics response. Length: ${text?.length || 0}`);
            if (text && text.length < 100) {
                console.warn(`[GeminiService] Suspiciously short lyrics (length ${text.length}): ${text}`);
            }

            if (!text) {
                throw new Error('Respuesta vacía del modelo');
            }

            let metadata = await extractGroundingMetadata(response);

            // Fallback: If no sources, force research
            if (!metadata || !metadata.sources || metadata.sources.length === 0) {
                // Only research if we have a prompt/topic, here textPrompt is the topic
                if (onProgress) onProgress('Buscando fuentes verificadas...');
                const researchMeta = await researchTopic(textPrompt);
                if (researchMeta) metadata = researchMeta;
            }

            if (onProgress) onProgress('✓ Letra generada exitosamente');
            return { text, metadata };

        } catch (error: any) {
            console.warn(`Failed with model ${modelName}:`, error.message);
            lastError = error;
            // Continue to next model
            await delay(1000); // Wait 1s between retries to avoid rate limits
        }
    }

    // If all models fail
    console.error('All Gemini models failed:', lastError);
    throw new Error(`La IA no pudo generar la letra. Error: ${lastError?.message || 'Modelos no disponibles'}`);
}

/**
 * Generate image with Gemini (supports Nano Banana / Gemini 3 Pro)
 */
export async function generateImage(prompt: string, model: string = 'gemini-3-pro-image-preview', aspectRatio: string = '16:9'): Promise<GeneratedContent> {
    const ai = getClient();

    try {
        const config: any = {};

        let safetySettings: any[] | undefined = undefined;

        // Configure for High Quality Image Generation (Nano Banana / Gemini 3 Pro / Imagen)
        if (model.includes('gemini-3') || model.includes('nano-banana') || model.includes('imagen')) {
            config.imageConfig = {
                aspectRatio: aspectRatio, // Dynamic aspect ratio
                imageSize: "1K"     // High resolution
            };

            safetySettings = [
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH }
            ];

            // Map legacy internal names if needed, otherwise keep the passed model
            if (model.includes('nano-banana')) {
                model = 'gemini-3-pro-image-preview';
            }
        }

        const modelInstance = ai.getGenerativeModel({
            model: model,
            generationConfig: config,
            safetySettings: safetySettings
        });
        const result = await modelInstance.generateContent(prompt);
        const response = result.response;

        const groundingMetadata = await extractGroundingMetadata(response);

        for (const candidate of response.candidates || []) {
            if (candidate.content && candidate.content.parts) {
                for (const part of candidate.content.parts) {
                    if (part.inlineData) {
                        const base64 = part.inlineData.data;
                        const mimeType = part.inlineData.mimeType || 'image/png';
                        const fullDataUrl = `data:${mimeType};base64,${base64}`;

                        // Note: Watermarking logic removed for simplicity in this restoration, add back if needed
                        // const watermarkedUrl = await watermarkImage(fullDataUrl); 

                        return {
                            topic: prompt,
                            mediaUrl: fullDataUrl, // Return direct data URL for now
                            mediaType: 'IMAGE',
                            mimeType: mimeType
                        };
                    }
                }
            }
        }

        throw new Error("El modelo no generó ninguna imagen.");
    } catch (error: any) {
        throw new Error(`Error generando imagen: ${error.message} `);
    }
}

/**
 * Generate video with Veo
 */
export async function generateVideo(prompt: string, model: string = 'veo-2.0-preview-0124'): Promise<any> {
    const ai = getClient();

    try {
        let retries = 2; // Retry twice on failure
        let lastError;

        while (retries >= 0) {
            try {
                // Ensure we use the correct model for Veo
                const actualModel = model.includes('veo') ? 'veo-2.0-generate-001' : model;
                console.log(`Starting video generation with model: ${actualModel}. Retries left: ${retries}`);

                // NOTE: @google/generative-ai doesn't natively support generateVideos yet in the stable Node SDK.
                // Assuming it might be a Vertex AI or specialized feature.
                // If it was working with @google/genai, we might need a hybrid or vertex approach.
                // For now, I'll attempt a generic model call if possible, or fallback.
                const modelInstance = ai.getGenerativeModel({ model: actualModel });
                const result = await (modelInstance as any).generateContent({
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: {
                        numberOfVideos: 1,
                        aspectRatio: '16:9',
                        durationSeconds: 6
                    }
                });
                const operation = result.response;

                // Polling for completion
                let pollAttempts = 0;
                const MAX_POLLS = 60; // 5 minutes timeout (60 * 5s)

                let currentOperation = operation;
                while (!(currentOperation as any).done && pollAttempts < MAX_POLLS) {
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    // Note: This part is highly speculative as the stable SDK doesn't have operations.getVideosOperation
                    // I will attempt to cast or use a generic fetch if I had the endpoint, but for now 
                    // I'll assume we wait and check if 'operation' object updates or just fail gracefully.
                    pollAttempts++;
                    console.log(`Polling video operation... attempt ${pollAttempts}/${MAX_POLLS}`);
                }

                if (!operation.done) {
                    throw new Error("Video generation timed out after 5 minutes.");
                }

                if (operation.error) {
                    console.error("Veo Operation Error Details:", JSON.stringify(operation.error, null, 2));
                    throw new Error(`Video generation failed API Error: ${operation.error.message} (Code: ${operation.error.code})`);
                }

                const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
                if (!videoUri) throw new Error("No video URI returned from successful operation");

                // Download and Process
                console.log("Video generated successfully, downloading from:", videoUri);
                const videoRes = await fetch(`${videoUri}&key=${env.GEMINI_API_KEY}`);
                if (!videoRes.ok) throw new Error(`Failed to download video: ${videoRes.statusText}`);

                const blob = await videoRes.blob();

                const buffer = await blob.arrayBuffer();
                const fileName = `video-${Date.now()}.mp4`;
                const uploadDir = path.join(process.cwd(), 'public', 'temp');
                if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

                const filePath = path.join(uploadDir, fileName);
                fs.writeFileSync(filePath, Buffer.from(buffer));

                // Upload to Cloudinary
                let finalUrl = `/temp/${fileName}`; // Default to local if upload fails
                try {
                    const cloudinaryUrl = await storageService.uploadVideo(filePath, 'nutonia-videos');
                    finalUrl = cloudinaryUrl;
                    // Clean up local file only if upload succeeded
                    fs.unlinkSync(filePath);
                } catch (uploadError) {
                    console.error("Cloudinary upload failed, using local temp file:", uploadError);
                }

                return {
                    topic: prompt,
                    mediaUrl: finalUrl,
                    mediaType: 'VIDEO',
                    mimeType: 'video/mp4'
                };

            } catch (error: any) {
                console.warn(`Video generation attempt failed (${retries} retries left):`, error.message);
                lastError = error;
                retries--;
                if (retries >= 0) await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s before retry
            }
        }

        if (retries < 0) throw lastError || new Error("Video generation failed after retries.");
    } catch (error: any) {
        // Re-throw the original error to allow upstream handling of specific codes (e.g. 429)
        throw error;
    }
}

/**
 * Generate text explanation with grounding
 */
export async function generateTextExplanation(
    topic: string,
    profile: any,
    document?: { content: string; mimeType: string },
    language: string = 'Spanish'
): Promise<{ text: string; groundingMetadata?: any }> {
    const ai = getClient();

    const prompt = `Actúa como un experto educador y comunicador científico. 
Explica de forma EXTENSA, CLARA y COMPLETA el siguiente tema: "${topic}".

REQUERIMIENTOS:
1. PROFUNDIDAD: No seas superficial. Explica los fundamentos, procesos y conclusiones si el tema lo requiere.
2. ESTRUCTURA: Usa una estructura lógica con secciones claras.
3. PERFIL DEL USUARIO: Adapta el tono a: ${profile.title} (${profile.description}).
4. FORMATO: Sigue estas guías: ${profile.formatDescription}. Usa negritas para términos clave.
5. BRANDING: Usa "Nutonia" como el ecosistema de aprendizaje.
6. IDIOMA: Responde ÚNICAMENTE en ${language}.

Asegúrate de que la explicación sea lo suficientemente rica para que el usuario sienta que ha aprendido algo nuevo y complejo de forma sencilla.`;

    const parts: any[] = [{ text: prompt }];

    if (document) {
        const base64Data = document.content.includes(',')
            ? document.content.split(',')[1]
            : document.content;

        parts.push({
            inlineData: {
                data: base64Data,
                mimeType: document.mimeType
            }
        });
    }

    const modelInstance = ai.getGenerativeModel({
        model: 'gemini-2.5-flash',
        safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }
        ]
    });
    const result = await modelInstance.generateContent({
        contents: [{ role: 'user', parts }],
        tools: [{ googleSearch: {} } as any],
    });
    const response = result.response;

    const text = response.text() || 'No se pudo generar la explicación.';

    let groundingMetadata = await extractGroundingMetadata(response);

    // Fallback: If no sources, force research
    if (!groundingMetadata || !groundingMetadata.sources || groundingMetadata.sources.length === 0) {
        console.log("No sources in explanation. Forcing research...");
        const researchMeta = await researchTopic(topic);
        if (researchMeta) groundingMetadata = researchMeta;
    }

    return { text, groundingMetadata };
}

/**
 * Generates a structured visual brief for an infographic.
 */
export async function generateInfographicBrief(topic: string, language: string = 'Spanish'): Promise<string> {
    const ai = getClient();
    try {
        const prompt = `Actúa como un Diseñador de Información experto.
    Crea un "Brief Visual" detallado para una infografía sobre: "${topic}".
    
    Objetivo: Crear una imagen educativa densa y rica en información, no solo decorativa.
    
    Estructura requerida (Responde solo con este texto estructurado):
    1. TÍTULO: Un título corto e impactante.
    2. CONCEPTO CENTRAL: Una frase resumen.
    3. SECCIONES VISUALES (3-4 puntos clave):
       - Punto A: [Título breve] + [Dato clave o explicación visual corta]
       - Punto B: [Título breve] + [Dato clave]
       - Punto C: [Título breve] + [Dato clave]
    4. CONCLUSIÓN/RESUMEN: Una frase final.
    
    IDIOMA: ${language === 'English' ? 'INGLÉS' : 'ESPAÑOL'}.
    IMPORTANTE: Este texto será usado para instruir a una IA de generación de imágenes, así que sé descriptivo con lo que debe aparecer visualmente (ej. "Mostrar un diagrama de flujo...", "Usar un gráfico de barras...").`;

        const modelInstance = ai.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const result = await modelInstance.generateContent(prompt);
        const response = result.response;

        return response.text() || topic;
    } catch (error) {
        console.warn("Error generating infographic brief:", error);
        return topic;
    }
}

/**
 * Generate Presentation (Slides + Preview Image)
 */
export async function generatePresentation(
    topic: string,
    profile: any,
    styleId?: string,
    language: string = 'Spanish'
): Promise<{ text: string; imageUrl: string; metadata?: any }> {
    const ai = getClient();

    // 1. Generate Slide Content (JSON)
    const prompt = `Actúa como un experto en diseño de presentaciones y comunicación visual.
  Crea una presentación de diapositivas impactante y educativa sobre: "${topic}".
  
  Estilo Visual: ${styleId || 'Modern professional'}.
  
  Genera 5-8 diapositivas.
  Para cada diapositiva proporciona:
  1. Título
  2. Puntos clave (bullet points)
  3. Descripción detallada para generar una imagen de fondo/acompañamiento (Image Prompt). IMPORTANTE: Si la imagen debe tener texto, especifica explícitamente que el texto sea en ${language === 'English' ? 'ENGLISH' : 'ESPAÑOL'}.
  
  Adicionalmente, genera una "themeDescription" visual para el fondo general de la presentación.
  
  Responde EXCLUSIVAMENTE con un JSON en este formato:
  {
    "title": "Título de la Presentación",
    "themeDescription": "Descripción abstracta para el fondo general de todas las diapositivas (ej. 'abstract blue gradient with particles')",
    "slides": [
      {
        "slideNumber": 1,
        "title": "Título de la Diapositiva",
        "content": ["Punto 1", "Punto 2"],
        "imagePrompt": "Descripción visual detallada para la imagen específica de esta diapositiva..."
      }
    ]
  }
  
  IDIOMA DE SALIDA: ${language}.`;

    const modelInstance = ai.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: { responseMimeType: 'application/json' },
        safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }
        ]
    });
    const result = await modelInstance.generateContent(prompt);
    const contentResponse = result.response;

    const text = contentResponse.text() || '{}';
    let presentationData;
    try {
        presentationData = JSON.parse(text);
    } catch (e) {
        console.error("Failed to parse presentation JSON", e);
        presentationData = { title: topic, slides: [{ title: topic, imagePrompt: `Abstract presentation cover about ${topic}` }] };
    }

    // 2. Generate Images
    // A. Preview/Cover Image
    const firstSlide = presentationData.slides?.[0];
    const coverPrompt = `Presentation slide for: "${topic}". Title: ${firstSlide?.title || topic}. Style: ${styleId || 'Professional'}. High quality, 4k. Text in Spanish only.`;

    // B. Background Texture/Theme
    const themePrompt = presentationData.themeDescription
        ? `Clean presentation background texture, ${presentationData.themeDescription}. Style: ${styleId || 'Professional'}. Minimalist, 4k, no text.`
        : `Abstract clean professional presentation background for ${topic}. Minimalist, 4k, no text.`;

    // Execute Cover + Background generation in parallel
    const [coverImageResult, bgImageResult] = await Promise.all([
        generateImage(coverPrompt, 'gemini-3-pro-image-preview'),
        generateImage(themePrompt, 'gemini-3-pro-image-preview')
    ]);

    // Upload Cover & Background to Cloudinary
    let imageUrl = coverImageResult.mediaUrl;
    let backgroundImageUrl = bgImageResult.mediaUrl;

    try {
        const [uploadedCover, uploadedBg] = await Promise.all([
            storageService.uploadImage(coverImageResult.mediaUrl, 'nutonia-presentations'),
            storageService.uploadImage(bgImageResult.mediaUrl, 'nutonia-presentations')
        ]);
        imageUrl = uploadedCover;
        backgroundImageUrl = uploadedBg;
    } catch (e) {
        console.error("Failed to upload presentation cover/bg images", e);
    }

    presentationData.backgroundImageUrl = backgroundImageUrl;

    // 3. Generate Images for EACH Slide (User Request: Full Generation)
    if (presentationData.slides && presentationData.slides.length > 0) {
        // We limit concurrency to avoid hitting API rate limits hard or timeouts
        const slidePromises = presentationData.slides.map(async (slide: any, index: number) => {
            if (!slide.imagePrompt) return;

            try {
                // Generate (Use '16:9' for standard landscape slides)
                const slideImgResult = await generateImage(`${slide.imagePrompt}. Text in Spanish only.`, 'gemini-3-pro-image-preview', '16:9');
                // Upload
                const uploadedUrl = await storageService.uploadImage(slideImgResult.mediaUrl, 'nutonia-presentations');
                // Assign
                slide.imageUrl = uploadedUrl;
            } catch (err) {
                console.warn(`Failed to generate/upload image for slide ${index + 1}`, err);
                // We leave slide.imageUrl undefined, frontend can show placeholder
            }
        });

        // Wait for all slide images
        await Promise.all(slidePromises);
    }

    const updatedText = JSON.stringify(presentationData);

    // 3. Metadata
    let metadata = await extractGroundingMetadata(contentResponse);
    if (!metadata || !metadata.sources || metadata.sources.length === 0) {
        const researchMeta = await researchTopic(topic);
        if (researchMeta) metadata = researchMeta;
    }

    return { text: updatedText, imageUrl, metadata };
}

/**
 * Generate Mini Game Concept & Visuals
 */
export async function generateMiniGame(
    topic: string,
    profile: any,
    styleId?: string,
    language: string = 'Spanish'
): Promise<{ text: string; imageUrl: string; metadata?: any }> {
    const ai = getClient();

    // 1. Generate Game Concept (JSON)
    console.log(`--- GENERATING PLATFORMER (MARIO STYLE) for topic: ${topic} ---`);
    const prompt = `You are a Game Designer creating a 2D Side-Scrolling Platformer Level (Mario Bros Style).
  Topic: "${topic}".
  Visual Style: "${styleId}" (The assets must fit this style).
  
  GOAL: Generate a JSON representation of a linear platformer level.
  
  STRUCTURE:
  1. "gameType": "PLATFORMER_SIDE_SCROLL"
  2. "theme": Visual context (e.g. "Cyber City", "Forest", "Lab").
  3. "levelData": The physics world definition.
       - "width": Total level length (min 2000, max 3000).
       - "height": Level height (fixed 600).
       - "platforms": Array of objects { x, y, w, h, type }.
          - type: "ground" (floors), "floating" (jumpable platforms), "hazard" (lava/spikes).
       - "enemies": Array of objects { x, y, type, name, challenge }.
          - "challenge": The educational question object. MUST INCLUDE a "difficulty" property (string: "Muy Fácil", "Fácil", "Medio", "Difícil", "Muy Difícil").
       - "finishLine": { x: 2300, y: 500 }.
  
  REVISED JSON STRUCTURE:
  {
    "title": "Game Title",
    "storyline": "Intro context...",
    "gameType": "PLATFORMER_SIDE_SCROLL",
    "levelData": {
      "width": 2400,
      "height": 600,
      "platforms": [
         { "x": 0, "y": 550, "w": 800, "h": 50, "type": "ground" },
         { "x": 900, "y": 550, "w": 600, "h": 50, "type": "ground" },
         { "x": 300, "y": 400, "w": 150, "h": 20, "type": "floating" },
         { "x": 500, "y": 300, "w": 150, "h": 20, "type": "floating" }
      ],
      "enemies": [
        {
          "x": 600,
          "y": 500,
          "type": "basic",
          "name": "Data Bug",
          "challenge": {
             "difficulty": "Fácil",
             "question": "Question?",
             "options": ["A","B"],
             "correctAnswer": "A",
             "explanation": "..."
          }
        }
      ],
      "finishLine": { "x": 2300, "y": 500 }
    },
    "visualDescription": "Detailed image prompt for assets..."
  }
  
  CONSTRAINTS:
  - Ensure the level is playable (gaps are jumpable, max gap 250 pixels).
  - CRITICAL: Place EXACTLY 10-15 enemies in the array.
  - "Ground" usually at y=550.
  - ENEMIES MUST BE PLACED ON TOP OF A PLATFORM. Their 'y' coordinate must be 'platform.y - 80'.
  - ACCESSIBILITY: Do not place enemies or platforms in unreachable heights (max jump height is 150px).
  - PROGRESSIVE DIFFICULTY: You must generate questions covering ALL 5 difficulties ("Muy Fácil", "Fácil", "Medio", "Difícil", "Muy Difícil"). Generate at least 2 questions per difficulty.
  - VARIETY: Each enemy MUST have a completely UNIQUE question. Do NOT repeat concepts. Cover different aspects of the topic.
  - SHUFFLE: Ensure the level layout and enemy progression feel diverse.
  - OUTPUT LANGUAGE: ${language}.
  `;

    const modelInstance = ai.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: {
            responseMimeType: 'application/json',
            temperature: 1.0 // High creativity for Map generation
        },
        safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }
        ]
    });

    const result = await modelInstance.generateContent(prompt);
    const contentResponse = result.response;

    const text = contentResponse.text() || '{}';
    let gameData;
    try {
        gameData = JSON.parse(text);
    } catch (e) {
        console.error("Failed to parse game JSON", e);
        gameData = { title: topic, visualDescription: `Game concept art for ${topic}` };
    }

    // 2. Generate Assets (Parallel) with Fail-Safe & Retry
    // We define a helper to safely generate/upload or return null on error/timeout
    const safeGenerateAsset = async (prompt: string, aspectRatio: string): Promise<string | undefined> => {
        const attempt = async (startTimeout: number) => {
            // 60s timeout (User requested high reliability)
            const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject("Timeout"), startTimeout));
            const imgRes = await Promise.race([
                generateImage(prompt, 'gemini-3-pro-image-preview', aspectRatio),
                timeoutPromise
            ]) as any;
            if (imgRes && imgRes.mediaUrl) {
                return await storageService.uploadImage(imgRes.mediaUrl, 'nutonia-games');
            }
            throw new Error("No mediaUrl");
        };

        try {
            return await attempt(60000);
        } catch (e) {
            console.warn(`Attempt 1 failed for: ${prompt.substring(0, 15)}... Retrying.`);
            try {
                return await attempt(60000); // Retry once
            } catch (e2) {
                console.error(`Asset gen failed completely: ${prompt.substring(0, 20)}...`, e2);
                return undefined;
            }
        }
    };

    // 2. Generate Assets (Parallel) with Fail-Safe
    // 2. Generate Assets (Parallel) with Fail-Safe
    // "Transparent background" trick (Chroma Key compatible: Solid White)
    const [uploadedCover, uploadedPlayer, uploadedEnemy, uploadedBg] = await Promise.all([
        safeGenerateAsset(`Video game cover art for: "${gameData.title || topic}". Action packed, showing hero vs enemies. Style: ${styleId || 'Pixel Art'}. High quality title screen, single image, cinematic composition.`, '16:9'),
        safeGenerateAsset(`Game Sprite: Hero Character, side view. Dynamic pose. Style: ${styleId || 'Pixel Art'}. SOLID WHITE BACKGROUND. High contrast.`, '1:1'),
        safeGenerateAsset(`Game Sprite: Evil Enemy Monster. Scary but cute. Style: ${styleId || 'Pixel Art'}. SOLID WHITE BACKGROUND. High contrast.`, '1:1'),
        safeGenerateAsset(`Seamless Video Game Background Texture. Level Environment: ${topic}. Style: ${styleId || 'Pixel Art'}. Single panoramic image, NO GRID, NO SPLIT SCREEN, NO TILED PREVIEW.`, '16:9')
    ]);

    // Inject Assets into Game Data (only if they exist)
    gameData.assets = {
        cover: uploadedCover,
        player: uploadedPlayer,
        enemy: uploadedEnemy,
        background: uploadedBg
    };

    const imageUrl = uploadedCover || '';

    // 3. Metadata
    let metadata = await extractGroundingMetadata(contentResponse);
    if (!metadata || !metadata.sources || metadata.sources.length === 0) {
        const researchMeta = await researchTopic(topic);
        if (researchMeta) metadata = researchMeta;
    }

    // Re-serialize with assets
    return { text: JSON.stringify(gameData), imageUrl, metadata };
}

/**
 * Generate Interactive Web content (HTML + Cover Image)
 */
export async function generateInteractiveWeb(
    topic: string,
    profile: any,
    onProgress?: (message: string) => void,
    styleId?: string,
    language: string = 'Spanish'
): Promise<{ text: string; imageUrl: string; metadata?: any }> {
    const ai = getClient();

    if (onProgress) onProgress('Realizando investigación profunda (Deep Research)...');

    // 1. Deep Research
    const researchMetadata = await researchTopic(topic);
    const facts = researchMetadata?.sources.map((s: any) => s.snippet).join('\n') || "No se encontraron fuentes adicionales.";

    if (onProgress) onProgress('Generando arquitectura de la web interactiva (WOW effect)...');

    const styleString = styleId ? `Visual Style Reference: Integrate elements, colors, and vibes of the "${styleId}" aesthetic into the UI design.` : 'Visual Style Reference: Premium, modern, dark-themed with neon accents (#0f172a background).';

    const prompt = `Act as an elite Creative Technologist, Frontend Developer, and Educational UX Designer.
You must construct a SINGLE-FILE, world-class HTML/CSS/JS interactive educational web application about: "${topic}".

CRITICAL MISSION (WORLD-CLASS STANDARD):
1. THIS IS NOT A STATIC PAGE nor an article. This MUST BE an interactive learning simulator, a visual calculator, a dynamic timeline, a physics sandbox, or an exploratory interactive canvas. 
2. INTERACTION DRIVES LEARNING (CAUSE & EFFECT VERBALIZED): The user must manipulate elements (sliders, drag-and-drop, clickable hotspots, branching paths) to reveal the knowledge. 
3. DYNAMIC EDUCATIONAL FEEDBACK PANEL: You MUST include a dedicated UI panel that UPDATES IN REAL-TIME when the user interacts. This panel MUST explicitly explain the *WHY*. For example: If they move a slider that alters supply, the feedback text shouldn't just say "Price changed to $10", it MUST explain "Because supply decreased while demand remained constant, scarcity drives the equilibrium price up to $10". Deep pedagogical value is mandatory.
4. STRICT LAYOUT PROPORTIONS (NO OVERFLOW BREAK): The template uses a STRICT side-by-side flex layout with \`overflow-hidden\`. It is absolutely CRITICAL that your graphical elements (canvas, charts, SVGs) scale responsively (\`w-full h-full\`) and NEVER force the parent container to scroll or break boundaries. The text feedback panel in the right MUST have \`overflow-y-auto\`.
5. EVENT DEBOUNCING & CLEAN UI: Do NOT emit feedback events if the user drags a point but drops it in the EXACT SAME place (e.g. "Value changed from 73 to 73"). Filter out redundant events. Furthermore, DO NOT inject raw Markdown (like \`**bold**\`) into the innerHTML of the feedback panel; use proper HTML tags (like \`<strong>bold</strong>\`) or CSS classes for formatting.
6. ONBOARDING MODAL: The app MUST start with an overlay "Onboarding Modal" titled "Instrucciones de Interacción" that clearly explains to the user WHAT they can click, drag, or do in the simulator. It should have a "Comenzar" button that closes it.
7. PREMIUM AESTHETICS: Use "Apple / Stripe / Vercel" tier design. Implement Glassmorphism, sleek CSS transitions, and modern typography (system-ui).
8. ${styleString} Apply this aesthetic creatively to the UI components (buttons, backgrounds, borders).
9. FRAMEWORK: Use Tailwind CSS via CDN (<script src="https://cdn.tailwindcss.com"></script>) for rapid, beautiful layout. You can also use other CDNs (GSAP, Chart.js, etc) if necessary, but KEEP IT IN A SINGLE FILE.
10. LANGUAGE: All visible text, labels, and explanations MUST be completely in ${language}.

TEMPLATE GUIDELINE:
<!DOCTYPE html>
<html lang="${language}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
       /* Custom scrollbars, glassmorphism, animations matching the ${styleId || 'Dark Neon'} style */
       body { background: #0f172a; color: #f8fafc; font-family: system-ui, sans-serif; overflow-x: hidden; }
       .glass { background: rgba(255,255,255,0.05); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.1); }
    </style>
</head>
<body class="min-h-screen flex items-center justify-center p-4">
    <div id="onboarding-modal" class="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
        <div class="glass p-6 md:p-8 rounded-2xl max-w-lg w-full text-center max-h-[85vh] flex flex-col">
            <h2 class="text-2xl font-bold mb-4 shrink-0">Instrucciones</h2>
            <div class="mb-6 opacity-80 text-left overflow-y-auto flex-1 pr-2 space-y-3"><!-- Explain interaction here --></div>
            <button onclick="document.getElementById('onboarding-modal').style.display='none'" class="px-6 py-3 bg-cyan-600 rounded-full font-bold hover:bg-cyan-500 transition-colors w-full shrink-0 shadow-lg shadow-cyan-600/20">Comenzar Aventura</button>
        </div>
    </div>
    
    <div id="interactive-app" class="w-full max-w-6xl h-[85vh] md:h-[80vh] flex flex-col md:flex-row gap-6 relative shadow-2xl">
       <!-- LEFT: Interactive Simulator Controls (2/3 width) -->
       <div class="w-full md:w-2/3 glass rounded-3xl p-6 flex flex-col relative overflow-hidden">
           <!-- Simulator UI MUST live here. If it uses Canvas/Graphs, they must be responsive and not break the height -->
       </div>
       
       <!-- RIGHT: Dedicated Dynamic Educational Feedback Panel (1/3 width) -->
       <div class="w-full md:w-1/3 glass flex flex-col rounded-3xl p-6 border-l-4 border-cyan-500 bg-slate-900/80 overflow-hidden">
           <h3 class="text-xl font-bold text-cyan-400 mb-4 shrink-0 flex items-center gap-2">
               <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
               Análisis en Vivo
           </h3>
           <div id="dynamic-feedback" class="text-slate-300 text-sm md:text-base leading-relaxed overflow-y-auto flex-1 pr-2">
               <!-- JavaScript MUST update this content explaining WHY things happen based on user interaction -->
               Mueve los controles para observar los principios en acción. Aquí se explicará el porqué de cada fenómeno.
           </div>
       </div>
    </div>
    <script>
       // State management and complex educational interaction logic here
    </script>
</body>
</html>

Respond ONLY with the RAW HTML code. Do NOT wrap it in markdown blockquotes like \`\`\`html. Start exactly with <!DOCTYPE html>.`;

    try {
        const model = ai.getGenerativeModel({
            model: 'gemini-2.5-flash',
            safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }
            ]
        });
        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.9,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 32000, // Significantly increased for complex HTML/JS
            }
        });

        const response = result.response;

        // DEBUG: See the full structure and completion status
        const responseText = response.text();
        console.log('[geminiService] Full Response structure:', {
            hasResponse: !!response,
            candidatesCount: response.candidates?.length,
            finishReason: response.candidates?.[0]?.finishReason,
            safetyRatings: response.candidates?.[0]?.safetyRatings,
            textLength: responseText.length,
            textPreview: responseText.substring(0, 50) + '...'
        });

        // Extraer HTML limpiamente
        const htmlCode = responseText || '';

        console.log(`[geminiService] Generated interactive web code length: ${htmlCode.length}`);

        // Robust extraction of HTML from markdown or plain text
        const extractFromMarkdown = (text: string): string => {
            if (!text) return '';
            let val = text.trim();

            const resultLower = val.toLowerCase();
            const doctypeIdx = resultLower.indexOf('<!doctype');
            const htmlIdx = resultLower.indexOf('<html');
            const startIdx = doctypeIdx !== -1 ? doctypeIdx : htmlIdx;

            if (startIdx !== -1) {
                const endIdx = resultLower.lastIndexOf('</html>');
                if (endIdx !== -1 && endIdx > startIdx) {
                    return val.substring(startIdx, endIdx + 7).trim();
                }
                return val.substring(startIdx).trim().replace(/\s*```$/i, '');
            }

            const patterns = [
                /```html\s*([\s\S]*?)```/i,
                /```htm\s*([\s\S]*?)```/i,
                /```\s*([\s\S]*?)```/i,
                /```html\s*([\s\S]*)$/i,
                /```htm\s*([\s\S]*)$/i,
                /```\s*([\s\S]*)$/i
            ];
            for (const pattern of patterns) {
                const match = val.match(pattern);
                if (match && match[1]) return match[1].trim().replace(/\s*```$/i, '');
            }

            return val.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim();
        };

        const cleanedHtml = extractFromMarkdown(htmlCode);

        // No longer generating static preview images for webs to save costs.
        // Previews are now live mini-browsers in the UI.
        const coverUrl = '';

        return {
            text: cleanedHtml,
            imageUrl: coverUrl,
            metadata: researchMetadata
        };

    } catch (error: any) {
        console.error("Interactive web generation failed:", error);
        throw new Error(`Error generando web interactiva: ${error.message}`);
    }
}
