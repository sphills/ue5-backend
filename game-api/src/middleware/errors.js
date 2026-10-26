import { AppError } from '../errors.js';

// mysql2 / network error codes that mean "database not reachable right now".
const DB_UNAVAILABLE = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'PROTOCOL_CONNECTION_LOST',
  'ER_CON_COUNT_ERROR',
  'ER_SERVER_SHUTDOWN',
]);

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
}

export function errorHandler(logger) {
  return (err, req, res, next) => {
    let status = 500;
    let body = { code: 'INTERNAL', message: 'Something went wrong' };

    if (err instanceof AppError) {
      status = err.status;
      body = { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) };
    } else if (err.type === 'entity.parse.failed') {
      status = 400;
      body = { code: 'BAD_JSON', message: 'Request body is not valid JSON' };
    } else if (err.type === 'entity.too.large') {
      status = 413;
      body = { code: 'BODY_TOO_LARGE', message: 'Request body is too large' };
    } else if (DB_UNAVAILABLE.has(err.code)) {
      status = 503;
      body = { code: 'SERVICE_UNAVAILABLE', message: 'The game database is unavailable. Try again shortly.' };
      res.set('Retry-After', '5');
    }

    if (status >= 500) logger.error({ err, reqId: req.id, path: req.path }, 'unhandled error');
    if (res.headersSent) return;
    res.status(status).json({ error: body });
  };
}
