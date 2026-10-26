import { unauthorized } from '../errors.js';
import { matchesAnyKey } from '../security.js';

export function bearerToken(req) {
  const header = req.get('authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : null;
}

/** Players (UE5 game client or WebClient): `Authorization: Bearer <token>`. Sets req.auth. */
export function requireSession(authService) {
  return async (req, res, next) => {
    const token = bearerToken(req);
    if (!token) throw unauthorized('AUTH_REQUIRED', 'Missing bearer token');
    const auth = await authService.authenticate(token);
    if (!auth) throw unauthorized('SESSION_INVALID', 'Session expired or signed out');
    req.auth = auth;
    next();
  };
}

/** UE5 dedicated servers: `X-Server-Key: <shared secret>`. */
export function requireServerKey(keys) {
  return (req, res, next) => {
    if (!matchesAnyKey(req.get('x-server-key'), keys)) {
      throw unauthorized('SERVER_KEY_INVALID', 'Missing or wrong server key');
    }
    next();
  };
}
