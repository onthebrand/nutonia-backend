import { Router } from 'express';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.js';
import { likeContent, commentContent, viewContent, shareContent } from '../controllers/contentController.js';

const router = Router();

// Interact with content
router.post('/:id/like', authMiddleware, likeContent);
router.post('/:id/comment', authMiddleware, commentContent);
router.post('/:id/view', optionalAuthMiddleware, viewContent);
router.post('/:id/share', optionalAuthMiddleware, shareContent);

export default router;
