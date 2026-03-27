import dotenv from 'dotenv';

dotenv.config();

interface EnvConfig {
    NODE_ENV: string;
    PORT: number;
    SUPABASE_URL: string;
    SUPABASE_ANON_KEY: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
    REDIS_URL: string;
    GEMINI_API_KEY: string;
    SUNO_API_KEY: string;
    CLOUDINARY_CLOUD_NAME: string;
    CLOUDINARY_API_KEY: string;
    CLOUDINARY_API_SECRET: string;
    MERCADOPAGO_ACCESS_TOKEN: string;
    MERCADOPAGO_PUBLIC_KEY: string;
    JWT_SECRET: string;
    JWT_EXPIRES_IN: string;
    FRONTEND_URL: string;
    RATE_LIMIT_WINDOW_MS: number;
    RATE_LIMIT_MAX_REQUESTS: number;
    FREE_TIER_CREDITS_ON_SIGNUP: number;
    FREE_TIER_DAILY_GENERATIONS: number;
}

function getEnvVar(key: string, defaultValue?: string): string {
    const value = process.env[key];
    if (!value && defaultValue === undefined) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value || defaultValue || '';
}

function getEnvVarAsNumber(key: string, defaultValue?: number): number {
    const value = process.env[key];
    if (!value && defaultValue === undefined) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value ? parseInt(value, 10) : (defaultValue as number);
}

export const env: EnvConfig = {
    NODE_ENV: getEnvVar('NODE_ENV', 'development'),
    PORT: getEnvVarAsNumber('PORT', 3001),
    SUPABASE_URL: getEnvVar('SUPABASE_URL'),
    SUPABASE_ANON_KEY: getEnvVar('SUPABASE_ANON_KEY'),
    SUPABASE_SERVICE_ROLE_KEY: getEnvVar('SUPABASE_SERVICE_ROLE_KEY'),
    REDIS_URL: getEnvVar('REDIS_URL', 'redis://localhost:6379'),
    GEMINI_API_KEY: getEnvVar('GEMINI_API_KEY'),
    SUNO_API_KEY: getEnvVar('SUNO_API_KEY'),
    CLOUDINARY_CLOUD_NAME: getEnvVar('CLOUDINARY_CLOUD_NAME', ''),
    CLOUDINARY_API_KEY: getEnvVar('CLOUDINARY_API_KEY', ''),
    CLOUDINARY_API_SECRET: getEnvVar('CLOUDINARY_API_SECRET', ''),
    MERCADOPAGO_ACCESS_TOKEN: getEnvVar('MERCADOPAGO_ACCESS_TOKEN', ''),
    MERCADOPAGO_PUBLIC_KEY: getEnvVar('MERCADOPAGO_PUBLIC_KEY', ''),
    JWT_SECRET: getEnvVar('JWT_SECRET'),
    JWT_EXPIRES_IN: getEnvVar('JWT_EXPIRES_IN', '7d'),
    FRONTEND_URL: getEnvVar('FRONTEND_URL', 'http://localhost:5173'),
    RATE_LIMIT_WINDOW_MS: getEnvVarAsNumber('RATE_LIMIT_WINDOW_MS', 60000),
    RATE_LIMIT_MAX_REQUESTS: getEnvVarAsNumber('RATE_LIMIT_MAX_REQUESTS', 100),
    FREE_TIER_CREDITS_ON_SIGNUP: getEnvVarAsNumber('FREE_TIER_CREDITS_ON_SIGNUP', 10),
    FREE_TIER_DAILY_GENERATIONS: getEnvVarAsNumber('FREE_TIER_DAILY_GENERATIONS', 5),
};
