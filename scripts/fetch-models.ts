import { env } from '../src/config/env.js';
import fs from 'fs';

async function fetchModels() {
    const key = env.GEMINI_API_KEY;
    if (!key) {
        console.error('No API key found!');
        return;
    }

    console.log('Fetching models with key ending in:', key.slice(-4));
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} - ${await response.text()}`);
        }
        const data = await response.json();
        fs.writeFileSync('available_models.json', JSON.stringify(data, null, 2));
        console.log('Successfully saved models to available_models.json');

        // Filter for generateContent supported models
        const generateModels = data.models.filter((m: any) =>
            m.supportedGenerationMethods.includes('generateContent')
        ).map((m: any) => m.name);

        console.log('Models supporting generateContent:');
        console.log(JSON.stringify(generateModels, null, 2));

    } catch (error) {
        console.error('Error fetching models:', error);
    }
}

fetchModels();
