// Signed cookies with node:crypto (HMAC-SHA256), so there's no cookie-parser dependency.
import crypto from 'node:crypto';

export function sign(value, secret) {
  const mac = crypto.createHmac('sha256', secret).update(value).digest('base64url');
  return `${value}.${mac}`;
}

export function unsign(signed, secret) {
  if (typeof signed !== 'string') return null;
  const dot = signed.lastIndexOf('.');
  if (dot <= 0) return null;
  const value = signed.slice(0, dot);
  const expected = Buffer.from(sign(value, secret));
  const actual = Buffer.from(signed);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  return value;
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in out) continue;
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

/** Attach req.cookie(name) / res.setCookie / res.clearSignedCookie helpers. */
export function cookieMiddleware({ secret, secure }) {
  const base = { httpOnly: true, sameSite: 'lax', secure, path: '/' };
  return (req, res, next) => {
    const raw = parseCookies(req.headers.cookie);
    req.signedCookie = (name) => unsign(raw[name], secret);
    res.setSignedCookie = (name, value, opts = {}) => res.cookie(name, sign(value, secret), { ...base, ...opts });
    res.clearSignedCookie = (name) => res.clearCookie(name, base);
    next();
  };
}
