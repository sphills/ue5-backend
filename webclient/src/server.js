import { config } from './config.js';
import { createApp } from './app.js';

const log = (level, fields, msg) => process.stdout.write(JSON.stringify({ time: new Date().toISOString(), level, service: 'webclient', ...fields, msg }) + '\n');
const logger = { info: (f, m) => log('info', f, m), error: (f, m) => log('error', f, m) };

const app = createApp({ config, logger });
const server = app.listen(config.port, config.host, () => {
  logger.info({ port: config.port, gameApi: config.gameApiUrl }, 'WebClient listening');
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
