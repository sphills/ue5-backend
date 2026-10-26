import { Router } from 'express';
import { ApiError } from '../apiClient.js';
import { safeNext } from '../middleware/session.js';

export function authRoutes() {
  const r = Router();

  r.get('/', (req, res) => res.redirect(req.apiToken ? '/stash' : '/login'));

  r.get('/login', (req, res) => {
    if (req.apiToken) return res.redirect('/stash');
    res.render('login', { title: 'Sign in', next: safeNext(req.query.next), values: {} });
  });

  r.post('/login', async (req, res) => {
    const username = String(req.body.username ?? '').trim();
    const password = String(req.body.password ?? '');
    const next = safeNext(req.body.next);
    try {
      const { token } = await req.api.login(username, password);
      res.startSession(token);
      res.redirect(next);
    } catch (err) {
      if (!(err instanceof ApiError) || err.status >= 500) throw err;
      res.status(err.status === 429 ? 429 : 400).render('login', {
        title: 'Sign in',
        next,
        values: { username },
        error: err.code === 'VALIDATION_ERROR' ? 'Wrong username or password' : err.message,
      });
    }
  });

  r.get('/register', (req, res) => {
    if (req.apiToken) return res.redirect('/stash');
    res.render('register', { title: 'Create account', values: {} });
  });

  r.post('/register', async (req, res) => {
    const values = { username: String(req.body.username ?? '').trim(), email: String(req.body.email ?? '').trim() };
    const password = String(req.body.password ?? '');
    if (password !== String(req.body.confirm ?? '')) {
      return res.status(400).render('register', { title: 'Create account', values, error: "The passwords don't match" });
    }
    try {
      const { token } = await req.api.register({ username: values.username, email: values.email || undefined, password });
      res.startSession(token);
      res.flash('success', 'Welcome! Your starter kit is in your stash.');
      res.redirect('/stash');
    } catch (err) {
      if (!(err instanceof ApiError) || err.status >= 500) throw err;
      res.status(err.status === 429 ? 429 : 400).render('register', {
        title: 'Create account',
        values,
        error: err.message,
        fieldErrors: err.details?.fields ?? {},
      });
    }
  });

  r.post('/logout', async (req, res) => {
    if (req.apiToken) await req.api.logout().catch(() => {}); // sign out locally even if the API is down
    res.endSession();
    res.flash('info', 'You are signed out.');
    res.redirect('/login');
  });

  return r;
}
