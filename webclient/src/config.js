try {
  process.loadEnvFile();
} catch {
  // no .env file
}

const env = process.env;
const nodeEnv = env.NODE_ENV ?? 'development';
const isProduction = nodeEnv === 'production';

function trustProxy(raw) {
  if (raw === undefined || raw === '') return 'loopback';
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw.split(',').map((s) => s.trim());
}

export const config = {
  env: nodeEnv,
  isProduction,
  host: env.HOST ?? '0.0.0.0',
  port: Number.parseInt(env.PORT ?? '3000', 10),
  trustProxy: trustProxy(env.TRUST_PROXY),
  gameApiUrl: (env.GAME_API_URL ?? 'http://127.0.0.1:4000').replace(/\/+$/, ''),
  apiTimeoutMs: Number.parseInt(env.GAME_API_TIMEOUT_MS ?? '8000', 10),
  // Signs the session, CSRF and flash cookies. Must be long and secret in production.
  cookieSecret: env.COOKIE_SECRET ?? 'dev-only-cookie-secret-change-me',
  secureCookies: env.SECURE_COOKIES ? env.SECURE_COOKIES === 'true' : isProduction,
  siteName: env.SITE_NAME ?? 'Stash',
};

if (isProduction && (!env.COOKIE_SECRET || env.COOKIE_SECRET.length < 32)) {
  throw new Error('Refusing to start in production: COOKIE_SECRET must be set to at least 32 characters');
}
