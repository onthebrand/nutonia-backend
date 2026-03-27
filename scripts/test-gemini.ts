import { GoogleGenAI } from '@google/genai';
import { env } from '../src/config/env.js';

async function testModels() {
    console.log('Testing Gemini API with key:', env.GEMINI_API_KEY ? 'Present' : 'Missing');
    const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

    // Try listing models first
    console.log('\n--- Testing listModels() ---');
    try {
        // @ts-ignore
        const listResp = await ai.models.list();
        console.log('listModels success! Found models:', listResp.models?.length);
        // @ts-ignore
        listResp.models?.slice(0, 3).forEach(m => console.log(`- ${m.name}`));
    } catch (e: any) {
        console.log('listModels failed:', e.message);
    }

    const modelsToTest = [
        'gemini-1.5-flash',
        'gemini-1.5-flash-001',
        'gemini-pro',
        'gemini-1.0-pro'
    ];

    for (const modelName of modelsToTest) {
        console.log(`\n--- Testing model: ${modelName} ---`);
        try {
            const response = await ai.models.generateContent({
                model: modelName,
                contents: [{ parts: [{ text: 'Hello' }] }]
            });
            console.log(`SUCCESS! Model ${modelName} is working.`);
        } catch (error: any) {
            console.log(`FAILED: ${modelName} - ${error.message}`);
        }
    }
}

testModels();
