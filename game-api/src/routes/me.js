import { Router } from 'express';
import { parse, fields, v } from '../validate.js';

export function meRoutes({ auth, inventory }) {
  const r = Router();

  r.get('/', async (req, res) => {
    res.json({ account: await auth.getProfile(req.auth.accountId) });
  });

  r.post('/password', async (req, res) => {
    const input = parse({ currentPassword: fields.password, newPassword: fields.password }, req.body);
    res.json(await auth.changePassword(req.auth.accountId, req.auth.sessionId, input));
  });

  r.get('/sessions', async (req, res) => {
    res.json({ sessions: await auth.listSessions(req.auth.accountId, req.auth.sessionId) });
  });

  r.delete('/sessions/:sessionId', async (req, res) => {
    const { sessionId } = parse({ sessionId: fields.id }, req.params);
    await auth.revokeSession(req.auth.accountId, sessionId);
    res.status(204).end();
  });

  r.get('/history', async (req, res) => {
    const { limit = 50 } = parse({ limit: v.int({ min: 1, max: 200 }).optional() }, req.query);
    res.json({ events: await inventory.history(req.auth.accountId, limit) });
  });

  return r;
}
