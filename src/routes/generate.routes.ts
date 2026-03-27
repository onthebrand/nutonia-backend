import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { checkCredits } from '../middleware/creditsCheck.js';
import * as generateController from '../controllers/generateController.js';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Generate content (queued)
router.post('/content', checkCredits, generateController.generateContent);

// Add POST /video-production route
router.post('/video-production', checkCredits, generateController.produceVideo);

// Get generation status
router.get('/status/:jobId', generateController.getGenerationStatus);

// Generate Lyrics
router.post('/lyrics', generateController.generateLyrics);

// Generate Single Image
router.post('/image', generateController.generateImage);

export default router;
