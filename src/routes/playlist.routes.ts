import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getPlaylists, createPlaylist, deletePlaylist, updatePlaylist } from '../controllers/playlistController.js';

const router = Router();

router.use(authMiddleware);

router.get('/', getPlaylists);
router.post('/', createPlaylist);
router.put('/:id', updatePlaylist);
router.delete('/:id', deletePlaylist);

export default router;
