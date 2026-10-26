// Password hashing and session tokens, using only node:crypto.
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

// scrypt parameters (N=2^15 costs ~32 MB and roughly 50-100 ms per hash on a server core).
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password, params = SCRYPT) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, params.keylen, params);
  return ['scrypt', params.N, params.r, params.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const params = { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem };
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, params);
  return crypto.timingSafeEqual(actual, expected);
}

// Hash computed once so logins for unknown usernames take as long as real ones.
let dummyHash = null;
export async function burnPasswordCheck(password) {
  dummyHash ??= await hashPassword('not-a-real-password');
  await verifyPassword(password, dummyHash);
  return false;
}

/** Opaque bearer token handed to the client. Only its SHA-256 is stored. */
export function newSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest();
}

/** Constant-time check of a presented key against a list of accepted keys. */
export function matchesAnyKey(presented, keys) {
  if (!presented || keys.length === 0) return false;
  const a = crypto.createHash('sha256').update(presented).digest();
  let ok = false;
  for (const key of keys) {
    const b = crypto.createHash('sha256').update(key).digest();
    ok = crypto.timingSafeEqual(a, b) || ok;
  }
  return ok;
}
