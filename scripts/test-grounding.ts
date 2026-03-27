import { generateTextExplanation } from '../src/services/geminiService';
import { env } from '../src/config/env.js';

async function testGrounding() {
    console.log('Testing Text Generation with Grounding (Google Search) using Gemini 2.5 Flash...');
    console.log('API Key present:', !!env.GEMINI_API_KEY);

    const topic = 'Latest breakthroughs in fusion energy 2024-2025';
    const profile = {
        title: 'Ciencia para todos',
        description: 'Explicaciones claras y profundas',
        formatDescription: 'Usa una estructura lógica con secciones claras'
    };

    try {
        console.log(`Calling generateTextExplanation for topic: "${topic}"...`);
        const result = await generateTextExplanation(topic, profile, undefined, 'Spanish');

        console.log('\nSUCCESS!');
        console.log('Explanation preview:', result.text.substring(0, 300) + '...');

        if (result.groundingMetadata) {
            console.log('\nGrounding Metadata found:');
            console.log('Search Queries:', result.groundingMetadata.searchQueries);
            console.log('Number of Sources:', result.groundingMetadata.sources?.length || 0);
            if (result.groundingMetadata.sources && result.groundingMetadata.sources.length > 0) {
                console.log('First Source Title:', result.groundingMetadata.sources[0].title);
                console.log('First Source URL:', result.groundingMetadata.sources[0].url);
            }
        } else {
            console.log('\nNo grounding metadata returned.');
        }
    } catch (error: any) {
        console.error('\nFAILED generation:');
        console.error(error.message);
    }
}

testGrounding();
