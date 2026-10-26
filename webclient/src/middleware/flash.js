// One-shot messages that survive a redirect (POST -> redirect -> GET).
const COOKIE = 'flash';

export function flashMiddleware() {
  return (req, res, next) => {
    const raw = req.signedCookie(COOKIE);
    if (raw) {
      try {
        res.locals.flash = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
      } catch {
        res.locals.flash = null;
      }
      res.clearSignedCookie(COOKIE);
    }
    res.flash = (type, text) => {
      const value = Buffer.from(JSON.stringify({ type, text: String(text).slice(0, 300) })).toString('base64url');
      res.setSignedCookie(COOKIE, value, { maxAge: 60 * 1000 });
    };
    next();
  };
}
