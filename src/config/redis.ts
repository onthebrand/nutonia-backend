import { Redis } from 'ioredis';
import { env } from './env.js';

// Parse URL to check if it's local
const isLocalRedis = env.REDIS_URL.includes('localhost') || env.REDIS_URL.includes('127.0.0.1');

// Create Redis connection
const url = new URL(env.REDIS_URL);
console.log(`Connecting to Redis at ${url.hostname} using ${url.protocol}...`);

export let redisStatus = 'INITIALIZING';

export const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null, // Required for BullMQ
    family: 4, // Force IPv4
    connectTimeout: 20000, 
    enableReadyCheck: false,
    lazyConnect: true, // Don't block startup
    retryStrategy(times: number) {
        redisStatus = 'RECONNECTING';
        return Math.min(times * 500, 5000);
    },
    tls: env.REDIS_URL.startsWith('rediss://') ? {
        rejectUnauthorized: false,
        servername: url.hostname
    } : undefined
});

redis.on('connect', () => {
    redisStatus = 'CONNECTED';
    console.log('✓ Redis connected successfully');
});

redis.on('error', (err: Error) => {
    redisStatus = 'ERROR';
    console.error('✗ Redis connection error:', err.message);
});

export default redis;
