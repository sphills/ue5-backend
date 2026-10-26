// In-memory fixed-window rate limiter. Fine for a single API process; with several
// processes behind a load balancer, move the counters to a shared store such as Redis.
import { AppError } from '../errors.js';

export function createRateLimiter({ windowMs, limit, keyFn, now = Date.now }) {
  const hits = new Map(); // key -> { count, resetAt }

  const sweep = setInterval(() => {
    const t = now();
    for (const [key, entry] of hits) if (entry.resetAt <= t) hits.delete(key);
  }, Math.max(windowMs, 10_000));
  sweep.unref?.();

  /** Count one hit for `key`. Returns { allowed, remaining, resetAt }. */
  function hit(key) {
    const t = now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    return { allowed: entry.count <= limit, remaining: Math.max(0, limit - entry.count), resetAt: entry.resetAt };
  }

  function middleware(req, res, next) {
    const { allowed, remaining, resetAt } = hit(keyFn(req));
    const resetSeconds = Math.max(0, Math.ceil((resetAt - now()) / 1000));
    res.set('RateLimit-Limit', String(limit));
    res.set('RateLimit-Remaining', String(remaining));
    res.set('RateLimit-Reset', String(resetSeconds));
    if (!allowed) {
      res.set('Retry-After', String(resetSeconds));
      return next(new AppError(429, 'RATE_LIMITED', `Too many attempts. Try again in ${resetSeconds} seconds.`));
    }
    next();
  }

  middleware.hit = hit;
  middleware.reset = () => hits.clear();
  middleware.stop = () => clearInterval(sweep);
  return middleware;
}
