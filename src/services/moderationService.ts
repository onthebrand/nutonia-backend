import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';
import { MODERATION_CONFIG, ModerationCategory } from '../config/moderationConfig.js';

// Gemini client for moderation
let moderationClient: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
    if (!moderationClient) {
        moderationClient = new GoogleGenerativeAI(env.GEMINI_API_KEY);
    }
    return moderationClient;
}

export interface ModerationResult {
    isAppropriate: boolean;
    confidence: number;
    violatedCategories: string[];
    reasoning: string;
    suggestion?: string;
}

export interface UserViolationStatus {
    isSuspended: boolean;
    suspensionEnd?: Date;
    violationCount: number;
    canGenerate: boolean;
}

/**
 * Analyze a prompt using AI to detect inappropriate content
 */
export async function analyzePrompt(
    prompt: string,
    userId: string
): Promise<ModerationResult> {
    try {
        const ai = getClient();

        // Build the moderation prompt
        const moderationPrompt = MODERATION_CONFIG.MODERATION_PROMPT.replace('{PROMPT}', prompt);

        // Call Gemini for analysis
        const model = ai.getGenerativeModel({
            model: 'gemini-2.0-flash-exp',
        });
        const resultRaw = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: moderationPrompt }] }],
            generationConfig: {
                temperature: 0.1, // Low temperature for consistent moderation
                responseMimeType: 'application/json',
            },
        });

        const resultText = resultRaw.response.text();
        const result = JSON.parse(resultText || "{}");

        const moderationResult: ModerationResult = {
            isAppropriate: result.is_appropriate,
            confidence: result.confidence,
            violatedCategories: result.violated_categories || [],
            reasoning: result.reasoning,
            suggestion: result.suggestion,
        };

        // Record the moderation flag in database
        await recordModerationFlag({
            userId,
            prompt,
            flagType: 'PRE_GENERATION',
            isAppropriate: moderationResult.isAppropriate,
            confidence: moderationResult.confidence,
            violatedCategories: moderationResult.violatedCategories,
            aiReasoning: moderationResult.reasoning,
        });

        return moderationResult;
    } catch (error: any) {
        console.error('Error analyzing prompt:', error);

        // On error, default to allowing (fail open) but log it
        console.warn('Moderation check failed, allowing content by default');
        return {
            isAppropriate: true,
            confidence: 0,
            violatedCategories: [],
            reasoning: 'Error en moderación - permitido por defecto',
        };
    }
}

/**
 * Check if a user is currently suspended
 */
export async function checkUserViolations(userId: string): Promise<UserViolationStatus> {
    try {
        // Use the database function to check suspension
        const { data: isSuspended, error: suspendedError } = await supabaseAdmin
            .rpc('is_user_suspended', { user_id_param: userId });

        if (suspendedError) {
            console.error('Error checking suspension:', suspendedError);
            return {
                isSuspended: false,
                violationCount: 0,
                canGenerate: true,
            };
        }

        // Get user details
        const { data: user, error: userError } = await supabaseAdmin
            .from('users')
            .select('violation_count, suspension_end')
            .eq('id', userId)
            .single();

        if (userError || !user) {
            return {
                isSuspended: false,
                violationCount: 0,
                canGenerate: true,
            };
        }

        return {
            isSuspended: isSuspended as boolean,
            suspensionEnd: user.suspension_end ? new Date(user.suspension_end) : undefined,
            violationCount: user.violation_count || 0,
            canGenerate: !isSuspended,
        };
    } catch (error) {
        console.error('Error checking user violations:', error);
        // Fail open - allow generation on error
        return {
            isSuspended: false,
            violationCount: 0,
            canGenerate: true,
        };
    }
}

/**
 * Record a violation and potentially suspend the user
 */
export async function recordViolation(params: {
    userId: string;
    violationType: 'INAPPROPRIATE_PROMPT' | 'INAPPROPRIATE_CONTENT' | 'REPEATED_VIOLATIONS' | 'SPAM' | 'ABUSE';
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    description: string;
    moderationFlagId?: string;
    autoSuspend?: boolean;
}): Promise<string> {
    try {
        const { data: violationId, error } = await supabaseAdmin.rpc('record_violation', {
            user_id_param: params.userId,
            violation_type_param: params.violationType,
            severity_param: params.severity,
            description_param: params.description,
            moderation_flag_id_param: params.moderationFlagId || null,
            auto_suspend: params.autoSuspend !== false, // Default to true
        });

        if (error) {
            console.error('Error recording violation:', error);
            throw new Error('Failed to record violation');
        }

        return violationId as string;
    } catch (error) {
        console.error('Error in recordViolation:', error);
        throw error;
    }
}

/**
 * Record a moderation flag in the database
 */
async function recordModerationFlag(params: {
    userId: string;
    prompt: string;
    flagType: 'PRE_GENERATION' | 'POST_GENERATION';
    isAppropriate: boolean;
    confidence: number;
    violatedCategories: string[];
    aiReasoning: string;
    contentId?: string;
}): Promise<string> {
    try {
        const { data, error } = await supabaseAdmin
            .from('content_moderation_flags')
            .insert({
                user_id: params.userId,
                content_id: params.contentId || null,
                prompt: params.prompt,
                flag_type: params.flagType,
                status: params.isAppropriate ? 'APPROVED' : 'REJECTED',
                is_appropriate: params.isAppropriate,
                confidence_score: params.confidence,
                violated_categories: params.violatedCategories,
                ai_reasoning: params.aiReasoning,
            })
            .select('id')
            .single();

        if (error) {
            console.error('Error recording moderation flag:', error);
            throw new Error('Failed to record moderation flag');
        }

        return data.id;
    } catch (error) {
        console.error('Error in recordModerationFlag:', error);
        throw error;
    }
}

/**
 * Get content policy for display to users
 */
export function getContentPolicy() {
    return MODERATION_CONFIG.CONTENT_POLICY;
}

/**
 * Submit a content report
 */
export async function submitContentReport(params: {
    reporterId?: string;
    contentId: string;
    category: ModerationCategory;
    reason: string;
    description?: string;
}): Promise<string> {
    try {
        const { data, error } = await supabaseAdmin
            .from('content_reports')
            .insert({
                reporter_id: params.reporterId || null,
                content_id: params.contentId,
                category: params.category,
                reason: params.reason,
                description: params.description,
                status: 'PENDING',
            })
            .select('id')
            .single();

        if (error) {
            console.error('Error submitting content report:', error);
            throw new Error('Failed to submit report');
        }

        return data.id;
    } catch (error) {
        console.error('Error in submitContentReport:', error);
        throw error;
    }
}

/**
 * Get user's violation history
 */
export async function getUserViolations(userId: string) {
    try {
        const { data, error } = await supabaseAdmin
            .from('user_violations')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error getting user violations:', error);
            return [];
        }

        return data;
    } catch (error) {
        console.error('Error in getUserViolations:', error);
        return [];
    }
}
