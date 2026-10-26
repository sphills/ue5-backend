import { Router } from 'express';
import { parse, fields } from '../validate.js';
import { createRateLimiter } from '../middleware/rateLimit.js';

const MINUTE = 60 * 1000;

export function authRoutes({ auth, requireSession }) {
  const r = Router();

  // Keyed on IP + username so one noisy player can't lock everyone else out, even when many
  // players arrive through the WebClient (which forwards their real IP).
  const loginLimiter = createRateLimiter({
    windowMs: 15 * MINUTE,
    limit: 10,
    keyFn: (req) => `${req.ip}|${String(req.body?.username ?? '').toLowerCase()}`,
  });
  const registerLimiter = createRateLimiter({ windowMs: 60 * MINUTE, limit: 5, keyFn: (req) => req.ip });

  r.post('/register', registerLimiter, async (req, res) => {
    const input = parse(
      { username: fields.username, password: fields.password, email: fields.email.optional(), client: fields.clientType },
      req.body,
    );
    const result = await auth.register({
      username: input.username,
      email: input.email,
      password: input.password,
      clientType: input.client,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    res.status(201).json(result);
  });

  r.post('/login', loginLimiter, async (req, res) => {
    const input = parse(
      { username: fields.username, password: fields.password, client: fields.clientType },
      req.body,
    );
    const result = await auth.login({
      username: input.username,
      password: input.password,
      clientType: input.client,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    res.json(result);
  });

  r.post('/logout', requireSession, async (req, res) => {
    await auth.logout(req.auth.accountId, req.auth.sessionId);
    res.status(204).end();
  });

  r.limiters = [loginLimiter, registerLimiter];
  return r;
}
