import { config, assertProductionConfig } from './config.js';
import { createLogger } from './logger.js';
import { createDb } from './db/pool.js';
import { createApp } from './app.js';

const logger = createLogger({ level: config.logLevel, base: { service: 'game-api' } });

assertProductionConfig(config);
if (config.serverKeys.length === 0) {
  logger.warn('GAME_SERVER_KEYS is empty: /v1/server endpoints will reject every request');
}

const db = createDb(config.db, { logger });
const app = createApp({ db, config, logger });

// Housekeeping: drop long-dead sessions once an hour.
const purge = setInterval(() => {
  app.locals.services.auth
    .purgeOldSessions()
    .then((n) => n && logger.info({ deleted: n }, 'purged old sessions'))
    .catch((err) => logger.error({ err }, 'session purge failed'));
}, 60 * 60 * 1000);
purge.unref();

const server = app.listen(config.port, config.host, () => {
  logger.info({ port: config.port, env: config.env }, 'Game API listening');
});

function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  server.close(async () => {
    await db.close().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
