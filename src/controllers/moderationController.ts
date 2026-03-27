import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import {
    getContentPolicy,
    submitContentReport,
    getUserViolations
} from '../services/moderationService.js';

/**
 * GET /api/moderation/policy
 * Get the content moderation policy
 */
export async function getPolicy(req: AuthRequest, res: Response): Promise<void> {
    try {
        const policy = getContentPolicy();
        res.json(policy);
    } catch (error) {
        console.error('Error getting policy:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * POST /api/moderation/report
 * Submit a content report
 */
export async function reportContent(req: AuthRequest, res: Response): Promise<void> {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { contentId, category, reason, description } = req.body;

        if (!contentId || !category || !reason) {
            res.status(400).json({ error: 'Missing required fields' });
            return;
        }

        const reportId = await submitContentReport({
            reporterId: req.user.id,
            contentId,
            category,
            reason,
            description
        });

        res.status(201).json({
            message: 'Report submitted successfully',
            reportId
        });
    } catch (error) {
        console.error('Error reporting content:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * GET /api/moderation/my-violations
 * Get current user's violation history
 */
export async function getMyViolations(req: AuthRequest, res: Response): Promise<void> {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const violations = await getUserViolations(req.user.id);
        res.json(violations);
    } catch (error) {
        console.error('Error getting violations:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
