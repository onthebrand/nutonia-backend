import Redis from 'ioredis';
import { env } from './env.js';

// Parse URL to check if it's local
const isLocalRedis = env.REDIS_URL.includes('localhost') || env.REDIS_URL.includes('127.0.0.1');

// Create Redis connection
export const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null, // Required for BullMQ
    // In dev, fail fast. In prod, use default retries
    retryStrategy(times) {
        if (env.NODE_ENV === 'development') {
            if (times > 3) {
                console.warn('⚠️ Redis dev connection failed multiple times. Queues may not work, but API will start.');
                return null; // Stop retrying
            }
            return Math.min(times * 50, 2000);
        }
        // Default reconnect strategy for prod
        return Math.min(times * 50, 2000);
    },
    tls: isLocalRedis ? undefined : {
        rejectUnauthorized: false
    }
});

redis.on('connect', () => {
    console.log('✓ Redis connected successfully');
});

redis.on('error', (err) => {
    console.error('✗ Redis connection error:', err);
});

export default redis;
