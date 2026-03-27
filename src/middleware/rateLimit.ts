import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { env } from '../config/env.js';
import redis from '../config/redis.js';

// Create a common Redis store config
const createRedisStore = (prefix: string) => {
    return new RedisStore({
        sendCommand: (...args: string[]) => redis.call(args[0], ...args.slice(1)) as any,
        prefix: `rl:${prefix}:`
    });
};

/**
 * General API rate limiter
 */
export const apiRateLimiter = rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX_REQUESTS,
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    store: createRedisStore('api'),
});

/**
 * Strict rate limiter for auth endpoints
 */
export const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts
    message: 'Too many authentication attempts, please try again later.',
    skipSuccessfulRequests: true,
    store: createRedisStore('auth'),
});

/**
 * Rate limiter for content generation (Redis-based)
 */
export async function generationRateLimiter(userId: string): Promise<boolean> {
    const key = `rate:generation:${userId}`;
    const count = await redis.incr(key);

    if (count === 1) {
        // Set expiry on first request (24 hours)
        await redis.expire(key, 86400);
    }

    // Check if user exceeded free tier limit
    return count <= env.FREE_TIER_DAILY_GENERATIONS;
}
