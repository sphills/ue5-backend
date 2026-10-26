// Runtime configuration, read once from the environment.
// A local .env file is loaded if present (Node's built-in loader, no dotenv needed).
try {
  process.loadEnvFile();
} catch {
  // no .env file: rely on the real environment
}

const env = process.env;

function int(name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new Error(`${name} must be an integer, got "${raw}"`);
  return n;
}

function list(name) {
  return (env[name] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Express "trust proxy": which hops may set X-Forwarded-For. The WebClient forwards the
// player's IP, so its address must be trusted for per-IP rate limits to work.
function trustProxy(raw) {
  if (raw === undefined || raw === '') return 'loopback';
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw.split(',').map((s) => s.trim());
}

const nodeEnv = env.NODE_ENV ?? 'development';

export const config = {
  env: nodeEnv,
  isProduction: nodeEnv === 'production',
  host: env.HOST ?? '0.0.0.0',
  port: int('PORT', 4000),
  trustProxy: trustProxy(env.TRUST_PROXY),
  logLevel: env.LOG_LEVEL ?? (nodeEnv === 'production' ? 'info' : 'debug'),

  db: {
    host: env.DB_HOST ?? '127.0.0.1',
    port: int('DB_PORT', 3306),
    user: env.DB_USER ?? 'game',
    password: env.DB_PASSWORD ?? '',
    database: env.DB_NAME ?? 'game',
    connectionLimit: int('DB_POOL_SIZE', 10),
  },

  // Shared secrets that UE5 dedicated servers send in the X-Server-Key header.
  // Several keys can be listed so they can be rotated without downtime.
  serverKeys: list('GAME_SERVER_KEYS'),
};

export function assertProductionConfig(cfg = config) {
  if (!cfg.isProduction) return;
  const problems = [];
  if (!cfg.db.password) problems.push('DB_PASSWORD is empty');
  if (cfg.serverKeys.length === 0) problems.push('GAME_SERVER_KEYS is empty');
  if (cfg.serverKeys.some((k) => k.length < 32)) problems.push('every GAME_SERVER_KEYS entry must be at least 32 characters');
  if (problems.length) throw new Error(`Refusing to start in production: ${problems.join('; ')}`);
}
