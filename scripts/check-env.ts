import { env } from '../src/config/env.js';

console.log('--- Environment Check ---');
console.log('NODE_ENV:', env.NODE_ENV);
if (env.GEMINI_API_KEY) {
    const key = env.GEMINI_API_KEY;
    const masked = key.substring(0, 4) + '...' + key.substring(key.length - 4);
    console.log('GEMINI_API_KEY loaded:', masked);
    console.log('Key length:', key.length);
} else {
    console.log('GEMINI_API_KEY: NOT FOUND');
}
console.log('-------------------------');
