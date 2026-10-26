import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { ApiError } from './apiClient.js';
import { cookieMiddleware } from './cookies.js';
import { sessionMiddleware } from './middleware/session.js';
import { csrfMiddleware } from './middleware/csrf.js';
import { flashMiddleware } from './middleware/flash.js';
import { helpers } from './view.js';
import { authRoutes } from './routes/auth.js';
import { stashRoutes } from './routes/stash.js';
import { accountRoutes } from './routes/account.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createApp({ config, logger = console }) {
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.set('view engine', 'pug');
  app.set('views', path.join(root, 'views'));
  app.disable('x-powered-by');
  app.locals.h = helpers;
  app.locals.siteName = config.siteName;

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { 'script-src': ["'self'"], 'style-src': ["'self'"], 'img-src': ["'self'", 'data:'], 'form-action': ["'self'"] },
      },
    }),
  );
  app.use('/static', express.static(path.join(root, 'public'), { maxAge: config.isProduction ? '7d' : 0 }));
  app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

  app.use((req, res, next) => {
    req.id = crypto.randomUUID();
    res.locals.path = req.path;
    res.set('Cache-Control', 'no-store'); // pages show live account data
    next();
  });
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));
  app.use(cookieMiddleware({ secret: config.cookieSecret, secure: config.secureCookies }));
  app.use(flashMiddleware());
  app.use(sessionMiddleware(config));
  app.use(csrfMiddleware());

  app.use(authRoutes());
  app.use(stashRoutes());
  app.use(accountRoutes());

  app.use((req, res) => {
    res.status(404).render('error', { title: 'Not found', message: "There's nothing at this address." });
  });

  app.use((err, req, res, next) => {
    if (err instanceof ApiError && err.status === 401) {
      // The Game API no longer accepts this token (expired, signed out elsewhere, password changed).
      res.endSession();
      res.flash('info', 'Your session ended. Please sign in again.');
      return res.redirect(req.method === 'GET' ? `/login?next=${encodeURIComponent(req.originalUrl)}` : '/login');
    }
    if (err instanceof ApiError && err.status === 503) {
      return res.status(503).render('error', {
        title: 'Game services offline',
        message: "We can't reach the game servers right now. Your items are safe; try again in a minute.",
      });
    }
    if (err instanceof ApiError && err.status < 500) {
      return res.status(err.status).render('error', { title: 'Something went wrong', message: err.message });
    }
    logger.error?.({ err: { message: err.message, stack: err.stack }, reqId: req.id }, 'webclient error');
    res.status(500).render('error', { title: 'Something went wrong', message: 'Unexpected error. Please try again.' });
  });

  return app;
}
