import { Request, Response } from 'express';
import { supabase, supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { z } from 'zod';

// Validation schemas
const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
    username: z.string().min(3).max(20).optional(),
});

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string(),
});

/**
 * POST /api/auth/register
 */
export async function register(req: Request, res: Response): Promise<void> {
    try {
        const { email, password, username, redirectTo } = registerSchema.extend({
            redirectTo: z.string().optional()
        }).parse(req.body);

        // Create user in Supabase Auth
        const { data: authData, error: authError } = await supabase.auth.signUp({
            email,
            password,
            options: {
                emailRedirectTo: redirectTo
            }
        });

        if (authError) {
            res.status(400).json({ error: authError.message });
            return;
        }

        if (!authData.user) {
            // If email confirmation is enabled, user might not be returned immediately if implicit login is disabled
            // But usually signUp returns the user object with a fake ID or similar if confirmation is required.
            // If it's null, something went wrong.
            if (authData.session === null && !authData.user) {
                // This case happens when email confirmation is required and implicit login is off?
                // Actually Supabase returns user object even if unconfirmed.
                res.status(500).json({ error: 'Failed to create user' });
                return;
            }
        }

        // If we have a user, try to create the profile.
        // Note: If email confirmation is on, the user is created but might not be able to sign in yet.
        // We should still create the profile in our public table if possible, or rely on a trigger.
        // However, since we are using the admin client here, we can insert into the users table.

        if (authData.user) {
            const { error: profileError } = await supabaseAdmin
                .from('users')
                .insert({
                    id: authData.user.id,
                    email,
                    username: username || email.split('@')[0],
                    credits: env.FREE_TIER_CREDITS_ON_SIGNUP,
                    onboarding_completed: false
                });

            if (profileError) {
                // If it's a duplicate key error, it might mean the user already exists (e.g. from a previous attempt)
                // We can ignore it or log it.
                console.error('Profile creation error:', profileError);
            } else {
                // Create initial credit transaction only if profile was created
                await supabaseAdmin.from('credit_transactions').insert({
                    user_id: authData.user.id,
                    amount: env.FREE_TIER_CREDITS_ON_SIGNUP,
                    type: 'EARN',
                    description: 'Welcome bonus',
                });
            }
        }

        res.status(201).json({
            message: 'User created successfully. Please check your email to verify your account.',
            user: authData.user ? {
                id: authData.user.id,
                email,
            } : null,
            session: authData.session,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            res.status(400).json({ error: 'Validation error', details: error.errors });
            return;
        }
        console.error('Register error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * POST /api/auth/login
 */
export async function login(req: Request, res: Response): Promise<void> {
    try {
        const { email, password } = loginSchema.parse(req.body);

        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) {
            res.status(401).json({ error: 'Invalid credentials' });
            return;
        }

        // Update last_login
        await supabaseAdmin
            .from('users')
            .update({ last_login: new Date().toISOString() })
            .eq('id', data.user.id);

        // Get user profile
        const { data: profile } = await supabaseAdmin
            .from('users')
            .select('id, email, username, credits, role, bio, avatar_url, onboarding_completed')
            .eq('id', data.user.id)
            .single();

        // Auto-refill Nutons for Admins local testing
        if (profile && profile.role === 'admin' && profile.credits < 10000) {
            profile.credits = 99999;
            await supabaseAdmin.from('users').update({ credits: 99999 }).eq('id', profile.id);
        }

        res.json({
            message: 'Login successful',
            user: profile,
            session: data.session,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            res.status(400).json({ error: 'Validation error', details: error.errors });
            return;
        }
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * POST /api/auth/sync
 * Ensures the user profile exists in the database.
 * Called after OAuth login or email verification.
 */
export async function syncUser(req: Request, res: Response): Promise<void> {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            res.status(401).json({ error: 'No authorization header' });
            return;
        }

        const token = authHeader.substring(7);
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);

        if (userError || !user) {
            res.status(401).json({ error: 'Invalid token' });
            return;
        }

        // Check if profile exists
        const { data: existingProfile } = await supabaseAdmin
            .from('users')
            .select('id')
            .eq('id', user.id)
            .single();

        if (!existingProfile) {
            // Create profile
            const { error: profileError } = await supabaseAdmin
                .from('users')
                .insert({
                    id: user.id,
                    email: user.email!,
                    username: user.user_metadata.full_name || user.email!.split('@')[0],
                    credits: env.FREE_TIER_CREDITS_ON_SIGNUP,
                    // avatar_url and onboarding_completed removed from insert as they might not exist
                });

            if (profileError) {
                console.error('Sync profile error:', profileError);
                res.status(500).json({ error: 'Failed to create profile' });
                return;
            }

            // Create initial credit transaction
            await supabaseAdmin.from('credit_transactions').insert({
                user_id: user.id,
                amount: env.FREE_TIER_CREDITS_ON_SIGNUP,
                type: 'EARN',
                description: 'Welcome bonus',
            });
        }

        // Return full profile merging DB and Metadata
        const { data: dbProfile, error: fetchError } = await supabaseAdmin
            .from('users')
            .select('id, email, username, credits, role')
            .eq('id', user.id)
            .single();

        if (fetchError) {
            console.error('Sync fetch profile error:', fetchError);
            res.status(500).json({ error: 'Failed to fetch profile details' });
            return;
        }

        // Auto-refill Nutons for Admins local testing
        let userCredits = dbProfile.credits;
        if (dbProfile.role === 'admin' && userCredits < 10000) {
            userCredits = 99999;
            await supabaseAdmin.from('users').update({ credits: 99999 }).eq('id', dbProfile.id);
        }

        // Merge with metadata
        const fullProfile = {
            id: dbProfile.id,
            email: user.email,
            credits: userCredits,
            role: dbProfile.role,
            channel: {
                handle: dbProfile.username || user.email!.split('@')[0], // Map username to handle
                displayName: user.user_metadata.full_name || dbProfile.username || user.email!.split('@')[0],
                avatarUrl: user.user_metadata.avatarUrl || user.user_metadata.avatar_url || ''
            },
            preferences: {
                autoplay: true,
                theme: 'dark',
                notifications: true
            },
            bio: user.user_metadata.bio || '',
            onboardingCompleted: user.user_metadata.onboardingCompleted || false,
            learningProfile: user.user_metadata.learningProfile || null
        };

        res.json({ user: fullProfile });

    } catch (error) {
        console.error('Sync user error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * GET /api/auth/me
 */
export async function getMe(req: Request, res: Response): Promise<void> {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            res.status(401).json({ error: 'No authorization header' });
            return;
        }

        const token = authHeader.substring(7);
        const { data, error } = await supabaseAdmin.auth.getUser(token);

        if (error || !data.user) {
            res.status(401).json({ error: 'Invalid token' });
            return;
        }

        const { data: dbProfile } = await supabaseAdmin
            .from('users')
            .select('id, email, username, credits, role')
            .eq('id', data.user.id)
            .single();

        // Auto-refill Nutons for Admins local testing
        if (dbProfile && dbProfile.role === 'admin' && dbProfile.credits < 10000) {
            dbProfile.credits = 99999;
            await supabaseAdmin.from('users').update({ credits: 99999 }).eq('id', dbProfile.id);
        }

        const fullProfile = {
            ...dbProfile,
            bio: data.user.user_metadata.bio || '',
            avatarUrl: data.user.user_metadata.avatarUrl || data.user.user_metadata.avatar_url || '',
            onboardingCompleted: data.user.user_metadata.onboardingCompleted || false,
            learningProfile: data.user.user_metadata.learningProfile || null
        };

        res.json({ user: fullProfile });
    } catch (error) {
        console.error('Get me error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * PUT /api/auth/profile
 * Updates the user's profile.
 */
export async function updateProfile(req: Request, res: Response): Promise<void> {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            res.status(401).json({ error: 'No authorization header' });
            return;
        }

        const token = authHeader.substring(7);
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);

        if (userError || !user) {
            res.status(401).json({ error: 'Invalid token' });
            return;
        }

        const { username, bio, avatarUrl, onboardingCompleted, learningProfile, hasAcceptedContentPolicy } = req.body;

        // 1. Update public.users for SQL columns (username)
        if (username !== undefined) {
            const { error: updateError } = await supabaseAdmin
                .from('users')
                .update({ username })
                .eq('id', user.id);

            if (updateError) {
                console.error('Update profile SQL error:', updateError);
                // Continue to update metadata even if SQL fails? No, better to fail.
                res.status(500).json({ error: 'Failed to update username' });
                return;
            }
        }

        // 2. Update auth.users metadata for other fields
        const metadataUpdates: any = {};
        if (bio !== undefined) metadataUpdates.bio = bio;
        if (avatarUrl !== undefined) metadataUpdates.avatarUrl = avatarUrl;
        if (onboardingCompleted !== undefined) metadataUpdates.onboardingCompleted = onboardingCompleted;
        if (learningProfile !== undefined) metadataUpdates.learningProfile = learningProfile;
        if (hasAcceptedContentPolicy !== undefined) metadataUpdates.hasAcceptedContentPolicy = hasAcceptedContentPolicy;

        if (Object.keys(metadataUpdates).length > 0) {
            const { error: metaError } = await supabaseAdmin.auth.admin.updateUserById(
                user.id,
                { user_metadata: metadataUpdates }
            );

            if (metaError) {
                console.error('Update profile metadata error:', metaError);
                res.status(500).json({ error: 'Failed to update profile metadata' });
                return;
            }
        }

        res.json({ message: 'Profile updated successfully' });

    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
