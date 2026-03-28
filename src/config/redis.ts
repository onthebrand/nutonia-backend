import { Redis } from 'ioredis';
import { env } from './env.js';

// Parse URL to check if it's local
const isLocalRedis = env.REDIS_URL.includes('localhost') || env.REDIS_URL.includes('127.0.0.1');

// Create Redis connection
const url = new URL(env.REDIS_URL);
console.log(`Connecting to Redis at ${url.hostname} using ${url.protocol}...`);

export const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null, // Required for BullMQ
    family: 4, // Force IPv4
    connectTimeout: 20000, // 20 seconds for slower handshakes
    enableReadyCheck: false, // Recommended for serverless/hosted Redis
    lazyConnect: false,
    // In dev, fail fast. In prod, use default retries
    retryStrategy(times: number) {
        return Math.min(times * 200, 3000);
    },
    tls: env.REDIS_URL.startsWith('rediss://') ? {
        rejectUnauthorized: false,
        servername: url.hostname // Important for SNI in multi-tenant environments
    } : undefined
});

redis.on('connect', () => {
    console.log('✓ Redis connected successfully');
});

redis.on('error', (err: Error) => {
    console.error('✗ Redis connection error:', err);
});

export default redis;
