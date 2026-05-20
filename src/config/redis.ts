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
    connectTimeout: 5000, // Faster timeout for local dev
    enableReadyCheck: false,
    lazyConnect: true, // DO NOT connect on import
    retryStrategy(times: number) {
        if (times > 3 && (env.REDIS_URL.includes('localhost') || env.REDIS_URL.includes('127.0.0.1'))) {
            // Give up quickly if local redis is missing to avoid process hanging
            redisStatus = 'OFFLINE';
            return null; // Stop retrying
        }
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

// CRITICAL: Prevent process crash on connection failure
redis.on('error', (err: any) => {
    redisStatus = 'ERROR';
    // Only log the message to avoid flooding the console with stacks
    console.error(`✗ Redis connection error: ${err.message}. Backend will continue without queue functionality.`);
    
    // If it's a connection error, it's captured here and won't throw unhandled exception
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
        // We handle it gracefully
    }
});

// Explicitly handle end events
redis.on('end', () => {
    redisStatus = 'DISCONNECTED';
});

export default redis;
