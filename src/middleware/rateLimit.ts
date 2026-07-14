import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { env } from '../config/env.js';
import redis from '../config/redis.js';

class HybridRateLimitStore {
    prefix: string;
    private redisStore: any = null;
    private memoryStore = new Map<string, { hits: number; resetTime: Date }>();
    private windowMs: number;

    constructor(prefix: string, windowMs: number) {
        this.prefix = prefix;
        this.windowMs = windowMs;
    }

    private getRedisStore() {
        if (this.redisStore) return this.redisStore;

        if (redis.status === 'ready' || redis.status === 'connect') {
            try {
                console.log(`[RateLimit] Dynamically initializing RedisStore for prefix: ${this.prefix}`);
                this.redisStore = new RedisStore({
                    sendCommand: (...args: string[]) => redis.call(args[0], ...args.slice(1)) as any,
                    prefix: `rl:${this.prefix}:`
                });
                return this.redisStore;
            } catch (error) {
                console.warn(`[RateLimit] Failed to dynamically initialize RedisStore for prefix: ${this.prefix}`, error);
                this.redisStore = null;
            }
        }
        return null;
    }

    async increment(key: string) {
        const store = this.getRedisStore();
        if (store) {
            try {
                return await store.increment(key);
            } catch (error) {
                console.warn(`[RateLimit] Redis increment failed for key ${key}, falling back to memory:`, error);
            }
        }

        const now = new Date();
        const record = this.memoryStore.get(key);

        if (!record || record.resetTime <= now) {
            const resetTime = new Date(now.getTime() + this.windowMs);
            const newRecord = { hits: 1, resetTime };
            this.memoryStore.set(key, newRecord);
            return { totalHits: 1, resetTime };
        }

        record.hits += 1;
        return { totalHits: record.hits, resetTime: record.resetTime };
    }

    async decrement(key: string): Promise<void> {
        const store = this.getRedisStore();
        if (store) {
            try {
                await store.decrement(key);
                return;
            } catch (error) {
                // Ignore and fallback
            }
        }

        const record = this.memoryStore.get(key);
        if (record && record.hits > 0) {
            record.hits -= 1;
        }
    }

    async resetKey(key: string): Promise<void> {
        const store = this.getRedisStore();
        if (store) {
            try {
                await store.resetKey(key);
                return;
            } catch (error) {
                // Ignore and fallback
            }
        }
        this.memoryStore.delete(key);
    }
}

const customKeyGenerator = (req: any) => {
    return (req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1') as string;
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
    store: new HybridRateLimitStore('api', env.RATE_LIMIT_WINDOW_MS),
    keyGenerator: customKeyGenerator,
});

/**
 * Strict rate limiter for auth endpoints
 */
export const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts
    message: 'Too many authentication attempts, please try again later.',
    skipSuccessfulRequests: true,
    store: new HybridRateLimitStore('auth', 15 * 60 * 1000),
    keyGenerator: customKeyGenerator,
});

/**
 * Rate limiter for content generation (Redis-based)
 */
export async function generationRateLimiter(userId: string): Promise<boolean> {
    if (redis.status !== 'ready' && redis.status !== 'connect') {
        console.warn(`[RateLimit] Redis offline during generation rate limit check for ${userId}. Bypassing limit.`);
        return true;
    }
    try {
        const key = `rate:generation:${userId}`;
        const count = await redis.incr(key);

        if (count === 1) {
            // Set expiry on first request (24 hours)
            await redis.expire(key, 86400);
        }

        // Check if user exceeded free tier limit
        return count <= env.FREE_TIER_DAILY_GENERATIONS;
    } catch (error) {
        console.warn(`[RateLimit] Redis generation rate limit error for key ${userId}, falling back gracefully:`, error);
        return true;
    }
}
