// Accounts and sessions: register, login, token checks, logout, password change.
import * as accounts from '../repositories/accounts.js';
import * as sessions from '../repositories/sessions.js';
import * as inv from '../repositories/inventory.js';
import { Inventory } from '../game/inventory.js';
import { RULES } from '../game/rules.js';
import { hashPassword, verifyPassword, burnPasswordCheck, newSessionToken, hashToken } from '../security.js';
import { conflict, forbidden, unauthorized, notFound, badRequest } from '../errors.js';
import { MAX_MATCH_SECONDS } from './inventoryService.js';

const TOUCH_AFTER_SECONDS = 60; // don't write last_seen_at on every request

export function profileView(row) {
  return {
    id: Number(row.id),
    username: row.username,
    email: row.email ?? null,
    credits: Number(row.credits),
    stashSlots: Number(row.stash_slots),
    inMatch: Boolean(Number(row.in_match)),
    createdAt: row.created_at,
  };
}

function sessionView(row, currentId) {
  return {
    id: Number(row.id),
    clientType: row.client_type,
    ip: row.ip,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    current: Number(row.id) === currentId,
  };
}

export function createAuthService({ db, catalog }) {
  async function openSession(tx, { accountId, clientType, ip, userAgent }) {
    if (clientType === 'game' && RULES.singleGameSession) {
      await sessions.revokeOthers(tx, accountId, { clientType: 'game' });
    }
    const token = newSessionToken();
    const ttlMs = RULES.sessionTtlMs[clientType];
    const id = await sessions.create(tx, {
      accountId,
      tokenHash: hashToken(token),
      clientType,
      ip,
      userAgent,
      ttlSeconds: Math.floor(ttlMs / 1000),
    });
    if (clientType === 'web') await sessions.trimActive(tx, accountId, 'web', RULES.maxActiveWebSessions);
    return { token, session: { id, clientType, expiresAt: new Date(Date.now() + ttlMs).toISOString() } };
  }

  async function register({ username, email, password, clientType, ip, userAgent }) {
    const passwordHash = await hashPassword(password);
    const cat = await catalog.get();
    const kit = RULES.starterKit.map(({ itemCode, quantity }) => {
      const def = cat.byCode(itemCode);
      if (!def) throw new Error(`Starter kit item "${itemCode}" is missing from item_definitions`);
      return { def, quantity };
    });

    try {
      return await db.transaction(async (tx) => {
        const accountId = await accounts.create(tx, {
          username,
          email,
          passwordHash,
          credits: 0,
          stashSlots: RULES.defaultStashSlots,
        });

        // Starter kit goes through the same rules engine and audit trail as any other grant.
        const engine = new Inventory({
          items: [],
          capacity: { stash: RULES.defaultStashSlots, loadout: RULES.loadoutSlots },
          catalog: cat,
        });
        engine.grant(kit, { container: 'stash', reason: 'starter_kit' });
        engine.addCredits(RULES.starterCredits, 'starter_kit');
        await inv.saveItems(tx, accountId, [], engine.items);
        await accounts.applyInventoryChange(tx, accountId, engine.creditsDelta);
        await inv.insertEvents(tx, accountId, engine.events, { actor: 'system', reason: 'starter_kit' });

        const opened = await openSession(tx, { accountId, clientType, ip, userAgent });
        const account = await accounts.findById(tx, accountId, MAX_MATCH_SECONDS);
        return { ...opened, account: profileView(account) };
      });
    } catch (err) {
      if (accounts.isDuplicateKey(err, 'uq_accounts_username_key')) throw conflict('USERNAME_TAKEN', 'That username is taken');
      if (accounts.isDuplicateKey(err, 'uq_accounts_email')) throw conflict('EMAIL_TAKEN', 'That email is already registered');
      throw err;
    }
  }

  async function login({ username, password, clientType, ip, userAgent }) {
    const row = await accounts.findForLogin(db, username);
    if (!row) {
      await burnPasswordCheck(password);
      throw unauthorized('INVALID_CREDENTIALS', 'Wrong username or password');
    }
    if (!(await verifyPassword(password, row.password_hash))) {
      throw unauthorized('INVALID_CREDENTIALS', 'Wrong username or password');
    }
    if (row.status === 'banned') throw forbidden('ACCOUNT_BANNED', 'This account is banned');

    const accountId = Number(row.id);
    return db.transaction(async (tx) => {
      const opened = await openSession(tx, { accountId, clientType, ip, userAgent });
      const account = await accounts.findById(tx, accountId, MAX_MATCH_SECONDS);
      return { ...opened, account: profileView(account) };
    });
  }

  /** Resolve a bearer token to { sessionId, accountId, clientType, username } or null. */
  async function authenticate(token) {
    if (!token || token.length > 128) return null;
    const row = await sessions.findActiveByTokenHash(db, hashToken(token));
    if (!row) return null;
    if (row.status === 'banned') throw forbidden('ACCOUNT_BANNED', 'This account is banned');
    if (Number(row.idle_seconds) >= TOUCH_AFTER_SECONDS) await sessions.touch(db, row.id);
    return {
      sessionId: Number(row.id),
      accountId: Number(row.account_id),
      clientType: row.client_type,
      username: row.username,
      expiresAt: row.expires_at,
    };
  }

  async function logout(accountId, sessionId) {
    await sessions.revoke(db, accountId, sessionId);
  }

  async function getProfile(accountId) {
    const row = await accounts.findById(db, accountId, MAX_MATCH_SECONDS);
    if (!row) throw notFound('ACCOUNT_NOT_FOUND', 'Account not found');
    return profileView(row);
  }

  async function listSessions(accountId, currentSessionId) {
    const rows = await sessions.listActive(db, accountId);
    return rows.map((r) => sessionView(r, currentSessionId));
  }

  async function revokeSession(accountId, sessionId) {
    const ok = await sessions.revoke(db, accountId, sessionId);
    if (!ok) throw notFound('SESSION_NOT_FOUND', 'No active session with that id');
  }

  async function changePassword(accountId, currentSessionId, { currentPassword, newPassword }) {
    if (currentPassword === newPassword) throw badRequest('SAME_PASSWORD', 'Pick a password different from the current one');
    const stored = await accounts.getPasswordHash(db, accountId);
    if (!stored || !(await verifyPassword(currentPassword, stored))) {
      throw unauthorized('INVALID_CREDENTIALS', 'Current password is wrong');
    }
    const hash = await hashPassword(newPassword);
    return db.transaction(async (tx) => {
      await accounts.setPasswordHash(tx, accountId, hash);
      // Sign out everywhere else (including the game client).
      const revoked = await sessions.revokeOthers(tx, accountId, { exceptId: currentSessionId });
      return { revokedSessions: revoked };
    });
  }

  async function purgeOldSessions() {
    return sessions.purgeOld(db);
  }

  return { register, login, authenticate, logout, getProfile, listSessions, revokeSession, changePassword, purgeOldSessions };
}
