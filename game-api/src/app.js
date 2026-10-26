// Builds the Express app from its dependencies, so tests can pass in their own db.
import crypto from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import { createCatalogCache } from './game/catalog.js';
import { loadItemDefinitions } from './repositories/inventory.js';
import { createAuthService } from './services/authService.js';
import { createInventoryService } from './services/inventoryService.js';
import { createMatchService } from './services/matchService.js';
import { requireSession, requireServerKey } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { publicRoutes } from './routes/public.js';
import { authRoutes } from './routes/auth.js';
import { meRoutes } from './routes/me.js';
import { inventoryRoutes } from './routes/inventory.js';
import { serverRoutes } from './routes/server.js';

export function createServices({ db, catalogTtlMs = 60_000 }) {
  const catalog = createCatalogCache(() => loadItemDefinitions(db), catalogTtlMs);
  const inventory = createInventoryService({ db, catalog });
  const auth = createAuthService({ db, catalog });
  const matches = createMatchService({ db, catalog, inventory });
  return { catalog, inventory, auth, matches };
}

export function createApp({ db, config, logger, services = createServices({ db }) }) {
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false, upgradeInsecureRequests: null })); // JSON only
  app.use((req, res, next) => {
    req.id = req.get('x-request-id')?.slice(0, 64) || crypto.randomUUID();
    res.set('X-Request-Id', req.id);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      logger.info(
        {
          reqId: req.id,
          method: req.method,
          path: req.originalUrl.split('?')[0],
          status: res.statusCode,
          ms: Number(process.hrtime.bigint() - started) / 1e6,
          ip: req.ip,
        },
        'request',
      );
    });
    next();
  });
  app.use(express.json({ limit: '64kb' }));

  const session = requireSession(services.auth);

  app.use(publicRoutes({ db, catalog: services.catalog }));
  const auth = authRoutes({ auth: services.auth, requireSession: session });
  app.use('/v1/auth', auth);
  app.use('/v1/me', session, meRoutes(services));
  app.use('/v1/inventory', session, inventoryRoutes(services));
  app.use('/v1/server', requireServerKey(config.serverKeys), serverRoutes(services));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  app.locals.services = services;
  app.locals.limiters = auth.limiters;
  return app;
}
