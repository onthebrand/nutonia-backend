import { GoogleGenAI } from '@google/genai';
import { env } from '../src/config/env.js';

async function listModels() {
    const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    try {
        const response = await ai.models.list();
        console.log('Available Models:');
        for (const model of response.models || []) {
            console.log(`- ${model.name} (${model.supportedGenerationMethods?.join(', ')})`);
        }
    } catch (error) {
        console.error('Error listing models:', error);
    }
}

listModels();
