import express from 'express';
import { authRouter } from './modules/auth/auth.router.ts';
import { usersRouter } from './modules/users/users.router.ts';
import {
  invitationsRouter,
  organisationsRouter,
} from './modules/organisations/organisations.router.ts';
import { auditRouter } from './modules/audit/audit.router.ts';
import { aiGatewayRouter } from './modules/ai-gateway/ai-gateway.router.ts';
import { farmsRouter } from './modules/farms/farms.router.ts';
import { locationsRouter } from './modules/locations/locations.router.ts';

import {
  createApiRateLimiter,
  securityHeadersMiddleware,
} from './middleware/security.ts';

/**
 * Modular Express API application (AI Studio Prototype Backend Adapter).
 * Designed with NestJS-aligned module boundaries so controllers, guards,
 * and services port 1:1 to NestJS modules (see docs/NESTJS_MIGRATION.md).
 */
export function createApiApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(securityHeadersMiddleware);
  app.use(express.json({ limit: '1mb' }));

  const generalApiLimiter = createApiRateLimiter({
    windowMs: 60_000,
    maxRequests: 180,
    keyPrefix: 'api-general',
    skip: (req) => req.path === '/health',
  });

  const sensitiveApiLimiter = createApiRateLimiter({
    windowMs: 60_000,
    maxRequests: 30,
    keyPrefix: 'api-sensitive',
  });

  app.use('/api/v1', generalApiLimiter);
  app.use('/api/v1/locations/search', sensitiveApiLimiter);
  app.use('/api/v1/auth/register-profile', sensitiveApiLimiter);
  app.use('/api/v1/ai', sensitiveApiLimiter);

  app.get('/api/v1/health', (_req, res) => {
    res.json({
      data: {
        service: 'field-fussion-api',
        backendAdapter: 'express-prototype',
        intendedTarget: 'nestjs',
        phase: 2,
        timestamp: new Date().toISOString(),
      },
    });
  });

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/organisations', organisationsRouter);
  app.use('/api/v1/invitations', invitationsRouter);
  app.use('/api/v1/audit-logs', auditRouter);
  app.use('/api/v1/ai', aiGatewayRouter);
  app.use('/api/v1/farms', farmsRouter);
  app.use('/api/v1/locations', locationsRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({
      error: {
        code: 'API_ROUTE_NOT_FOUND',
        message: 'The requested FIELD FUSSION API endpoint does not exist.',
      },
    });
  });

  return app;
}
