import { Redis } from 'ioredis';
import { env } from './env.js';

// Parse URL to check if it's local
const isLocalRedis = env.REDIS_URL.includes('localhost') || env.REDIS_URL.includes('127.0.0.1');

// Create Redis connection
console.log(`Connecting to Redis at ${env.REDIS_URL.split('@')[1] || 'URL masked'}...`);

export const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null, // Required for BullMQ
    family: 4, // Force IPv4 to avoid Render/Upstash resolution issues
    connectTimeout: 10000, // 10 seconds
    // In dev, fail fast. In prod, use default retries
    retryStrategy(times: number) {
        const delay = Math.min(times * 100, 3000);
        if (env.NODE_ENV === 'development' && times > 3) {
            console.warn('⚠️ Redis dev connection failed. Skipping...');
            return null;
        }
        return delay;
    },
    tls: env.REDIS_URL.startsWith('rediss://') ? {
        rejectUnauthorized: false
    } : undefined
});

redis.on('connect', () => {
    console.log('✓ Redis connected successfully');
});

redis.on('error', (err: Error) => {
    console.error('✗ Redis connection error:', err);
});

export default redis;
