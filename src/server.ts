import './services/queueService.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { apiRateLimiter } from './middleware/rateLimit.js';

// Import routes
// Import routes
import authRoutes from './routes/auth.routes.js';
import feedRoutes from './routes/feed.routes.js';
import generateRoutes from './routes/generate.routes.js';
import libraryRoutes from './routes/library.routes.js';
import shareRoutes from './routes/share.routes.js';
import creditsRoutes from './routes/credits.routes.js';
import usersRoutes from './routes/users.routes.js';
import moderationRoutes from './routes/moderation.routes.js';
import adminRoutes from './routes/admin.routes.js';
import playlistRoutes from './routes/playlist.routes.js';
import contentRoutes from './routes/content.routes.js';

const app = express();

// Security middleware
app.use(helmet());
app.use(
    cors({
        origin: (origin, callback) => {
            // Allow requests with no origin (like mobile apps or curl requests)
            if (!origin) return callback(null, true);
            // Allow any localhost origin
            if (origin.match(/^http:\/\/localhost:\d+$/)) {
                return callback(null, true);
            }
            
            // Allow production domains
            const allowedDomains = [
                'https://onthebrand.cl',
                'https://www.onthebrand.cl',
                'https://onthebrand-neurolearn.vercel.app',
                env.FRONTEND_URL
            ];

            if (allowedDomains.includes(origin) || origin.endsWith('.vercel.app')) {
                return callback(null, true);
            }

            const msg = 'The CORS policy for this site does not allow access from the specified Origin: ' + origin;
            return callback(new Error(msg), false);
        },
        credentials: true,
    })
);

import path from 'path';

// Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files from 'public' directory
app.use(express.static(path.join(process.cwd(), 'public')));

// Rate limiting
app.use(apiRateLimiter);

import { redisStatus } from './config/redis.js';

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        redis: redisStatus,
        timestamp: new Date().toISOString(),
        environment: env.NODE_ENV,
    });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/generate', generateRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/playlists', playlistRoutes);
app.use('/api/share', shareRoutes);
app.use('/api/credits', creditsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/moderation', moderationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/content', contentRoutes);


// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
const PORT = env.PORT;

app.listen(PORT, () => {
    console.log(`
  â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
  â•‘   ðŸš€ Nutonia API Server Running      â•‘
  â• â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•£
  â•‘  Environment: ${env.NODE_ENV.padEnd(24)} â•‘
  â•‘  Port: ${PORT.toString().padEnd(30)} â•‘
  â•‘  URL: http://localhost:${PORT.toString().padEnd(17)} â•‘
  â•‘  Worker: âœ“ BullMQ queue active       â•‘
  â•‘  Reload: Force restart for fixes     â•‘
  â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  `);
});

export default app;
