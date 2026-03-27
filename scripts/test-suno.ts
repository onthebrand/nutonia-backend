import { env } from '../src/config/env.js';
import fetch from 'node-fetch';
import fs from 'fs';

async function testSuno() {
    const key = env.SUNO_API_KEY;
    if (!key) {
        console.error('No SUNO_API_KEY found!');
        return;
    }

    console.log('Testing Suno API with key ending in:', key.slice(-4));

    const url = 'https://api.sunoapi.org/api/v1/generate';

    const body = {
        prompt: "[Verse]\nTesting the API\nHope it works\n\n[Chorus]\nSuno please work",
        tags: "pop, upbeat",
        model: 'chirp-v3-0',
        title: "Test Song",
        make_instrumental: false,
        instrumental: false,
        custom_mode: true,
        callBackUrl: 'https://nutonia-api.vercel.app/api/webhook/suno',
    };

    console.log('Sending payload:', JSON.stringify(body, null, 2));

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${key}`
            },
            body: JSON.stringify(body)
        });

        const data = await response.json();
        console.log('Response Status:', response.status);

        fs.writeFileSync('suno_response.json', JSON.stringify(data, null, 2));
        console.log('Saved response to suno_response.json');

    } catch (error) {
        console.error('Error:', error);
    }
}

testSuno();
