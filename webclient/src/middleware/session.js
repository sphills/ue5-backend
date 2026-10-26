// The browser holds the player's Game API token in a signed, HttpOnly cookie. The WebClient
// keeps no state of its own: each request builds a GameApi client carrying that token.
import { GameApi } from '../apiClient.js';

export const SESSION_COOKIE = 'sid';
const WEB_SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // matches the API's web session TTL

export function sessionMiddleware(config) {
  return (req, res, next) => {
    req.apiToken = req.signedCookie(SESSION_COOKIE);
    req.api = new GameApi({
      baseUrl: config.gameApiUrl,
      token: req.apiToken,
      clientIp: req.ip,
      userAgent: req.get('user-agent'),
      requestId: req.id,
      timeoutMs: config.apiTimeoutMs,
    });
    res.startSession = (token) => {
      res.setSignedCookie(SESSION_COOKIE, token, { maxAge: WEB_SESSION_MAX_AGE });
    };
    res.endSession = () => res.clearSignedCookie(SESSION_COOKIE);
    res.locals.signedIn = Boolean(req.apiToken);
    next();
  };
}

/** Pages behind login. The API is the judge of whether the token is still valid. */
export function requireLogin(req, res, next) {
  if (req.apiToken) return next();
  const back = req.method === 'GET' ? `?next=${encodeURIComponent(req.originalUrl)}` : '';
  res.redirect(`/login${back}`);
}

/** Only allow local redirect targets, to avoid open redirects via ?next=. */
export function safeNext(value, fallback = '/stash') {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) ? value : fallback;
}
