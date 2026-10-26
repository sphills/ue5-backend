import { Router } from 'express';
import { ApiError } from '../apiClient.js';
import { requireLogin } from '../middleware/session.js';

export function accountRoutes() {
  const r = Router();
  r.use('/account', requireLogin);

  r.get('/account', async (req, res) => {
    const [{ account }, { sessions }, { events }] = await Promise.all([req.api.me(), req.api.sessions(), req.api.history(20)]);
    res.render('account', { title: 'Account', account, sessions, events });
  });

  r.post('/account/password', async (req, res) => {
    const { currentPassword = '', newPassword = '', confirm = '' } = req.body;
    if (newPassword !== confirm) {
      res.flash('error', "The new passwords don't match.");
      return res.redirect('/account');
    }
    try {
      const { revokedSessions } = await req.api.changePassword(currentPassword, newPassword);
      res.flash('success', `Password changed. Signed out ${revokedSessions} other session${revokedSessions === 1 ? '' : 's'}.`);
    } catch (err) {
      // 401 here means "current password wrong", not "signed out"
      if (!(err instanceof ApiError) || err.status >= 500 || err.code === 'SESSION_INVALID') throw err;
      res.flash('error', err.code === 'VALIDATION_ERROR' ? 'Passwords must be 8-128 characters.' : err.message);
    }
    res.redirect('/account');
  });

  r.post('/account/sessions/:id/revoke', async (req, res) => {
    try {
      await req.api.revokeSession(req.params.id);
      res.flash('success', 'Session signed out.');
    } catch (err) {
      if (!(err instanceof ApiError) || err.status === 401 || err.status >= 500) throw err;
      res.flash('error', err.message);
    }
    res.redirect('/account');
  });

  return r;
}
