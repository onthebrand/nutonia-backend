import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getLibrary, saveToLibrary, deleteFromLibrary, updateContent } from '../controllers/libraryController.js';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

router.get('/', getLibrary);
router.post('/', saveToLibrary);
router.put('/:id', updateContent);
router.delete('/:id', deleteFromLibrary);

export default router;
