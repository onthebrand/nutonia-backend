import { generateImage } from '../src/services/geminiService';
import { env } from '../src/config/env.js';

async function testImageGen() {
    console.log('Testing Image Generation with Gemini 3 Pro...');
    console.log('API Key present:', !!env.GEMINI_API_KEY);

    const prompt = 'A futuristic classroom with diverse students using holographic interfaces, detailed, cinematic lighting, educational theme';

    try {
        console.log('Calling generateImage...');
        const result = await generateImage(prompt, 'gemini-3-pro-image-preview', '16:9');

        console.log('\nSUCCESS!');
        console.log('Topic:', result.topic);
        console.log('Media Type:', result.mediaType);
        console.log('Media URL length:', result.mediaUrl.length);
        console.log('Mime Type:', result.mimeType);

        if (result.mediaUrl.startsWith('data:image')) {
            console.log('Successfully generated a base64 image URL.');
        } else {
            console.log('Generated URL:', result.mediaUrl);
        }
    } catch (error: any) {
        console.error('\nFAILED image generation:');
        console.error(error.message);
        if (error.stack) {
            // console.error(error.stack);
        }
    }
}

testImageGen();
