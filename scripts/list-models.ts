import { GoogleGenAI } from '@google/genai';
import { env } from '../src/config/env.js';

async function listModels() {
    try {
        const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

        console.log('Listing models...');
        // The new SDK might use a different method or property for listing models
        // Let's try to find it or just test a known model

        try {
            // @ts-ignore
            const response = await ai.models.list();
            console.log('Available Models:');
            // @ts-ignore
            for (const model of response.models || []) {
                console.log(`- ${model.name} (${model.displayName})`);
            }
        } catch (e: any) {
            console.log('ai.models.list() failed:', e.message);
        }

    } catch (error: any) {
        console.error('Error:', error);
    }
}

listModels();
