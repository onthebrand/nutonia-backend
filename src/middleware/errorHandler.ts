import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';

export interface AppError extends Error {
    statusCode?: number;
    isOperational?: boolean;
}

/**
 * Global error handler middleware
 */
export function errorHandler(
    err: AppError,
    req: Request,
    res: Response,
    next: NextFunction
): void {
    const statusCode = err.statusCode || 500;
    const message = err.message || 'Internal Server Error';

    console.error('Error:', {
        path: req.path,
        method: req.method,
        statusCode,
        message,
        stack: err.stack,
    });

    res.status(statusCode).json({
        error: message,
        ...(env.NODE_ENV === 'development' && { stack: err.stack }),
    });
}

/**
 * 404 handler
 */
export function notFoundHandler(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    res.status(404).json({
        error: 'Route not found',
        path: req.path,
    });
}
