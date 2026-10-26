// Double-submit CSRF protection: a random token lives in a signed cookie and must be echoed
// back in every POSTed form as `_csrf`. Combined with SameSite=Lax cookies.
import crypto from 'node:crypto';

const COOKIE = 'csrf';

export function csrfMiddleware() {
  return (req, res, next) => {
    let token = req.signedCookie(COOKIE);
    if (!token) {
      token = crypto.randomBytes(24).toString('base64url');
      res.setSignedCookie(COOKIE, token);
    }
    res.locals.csrfToken = token;

    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const sent = req.body?._csrf;
    const ok =
      typeof sent === 'string' &&
      sent.length === token.length &&
      crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(token));
    if (!ok) {
      res.status(403);
      return res.render('error', {
        title: 'Form expired',
        message: 'That form expired or came from somewhere else. Go back, reload the page and try again.',
      });
    }
    next();
  };
}
