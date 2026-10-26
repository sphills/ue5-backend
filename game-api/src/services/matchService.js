// Server-authoritative operations, called only by UE5 dedicated servers (X-Server-Key).
import * as accounts from '../repositories/accounts.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { MAX_MATCH_SECONDS } from './inventoryService.js';

export function createMatchService({ db, catalog, inventory }) {
  async function resolveEntries(entries) {
    const cat = await catalog.get();
    return entries.map(({ itemCode, quantity }) => {
      const def = cat.byCode(itemCode);
      if (!def) throw badRequest('UNKNOWN_ITEM', `No item with code "${itemCode}"`);
      return { def, quantity };
    });
  }

  /** Mark the player as in a match. Locks their loadout against player edits. Idempotent. */
  async function startMatch(accountId, matchId) {
    return db.transaction(async (tx) => {
      const account = await accounts.lockById(tx, accountId, MAX_MATCH_SECONDS);
      if (!account) throw notFound('ACCOUNT_NOT_FOUND', 'Account not found');
      if (account.active_match_id === matchId && Number(account.in_match)) {
        return { accountId, matchId, alreadyStarted: true };
      }
      if (account.last_match_id === matchId) {
        throw conflict('MATCH_ALREADY_ENDED', `Match ${matchId} has already ended for this player`);
      }
      // A different, stale match may still be recorded (e.g. a crashed server). The server
      // starting a new one is authoritative, so it simply replaces it.
      await accounts.startMatch(tx, accountId, matchId);
      return { accountId, matchId, alreadyStarted: false, replacedMatchId: account.active_match_id ?? null };
    });
  }

  /**
   * End the match: remove consumed/lost items, deliver loot (as much as fits, the rest is
   * reported back as undelivered), add credits, and unlock the loadout. Calling it again with
   * the same matchId is a safe no-op, so servers can retry on network errors.
   */
  async function endMatch(accountId, { matchId, grants = [], credits = 0, consume = [] }) {
    const entries = await resolveEntries(grants);
    return inventory.mutate(accountId, { actor: 'server', reason: `match:${matchId}` }, async (engine, account, tx) => {
      if (account.active_match_id !== matchId) {
        if (account.last_match_id === matchId) return { matchId, alreadyProcessed: true, delivered: [], undelivered: [] };
        throw conflict('MATCH_MISMATCH', `Player is not in match ${matchId}`, { activeMatchId: account.active_match_id ?? null });
      }
      for (const { itemId, quantity } of consume) engine.consume(itemId, quantity);
      const { delivered, undelivered } = engine.grant(entries, { container: 'stash', partial: true });
      engine.addCredits(credits);
      await accounts.endMatch(tx, accountId, matchId);
      return { matchId, alreadyProcessed: false, delivered, undelivered, credits };
    });
  }

  /** Out-of-match grant (rewards, purchases, support). All or nothing. */
  async function grant(accountId, { items = [], credits = 0, reason, container = 'stash' }) {
    const entries = await resolveEntries(items);
    return inventory.mutate(accountId, { actor: 'server', reason }, (engine) => {
      const res = engine.grant(entries, { container, reason });
      engine.addCredits(credits, reason);
      return { ...res, credits };
    });
  }

  return { startMatch, endMatch, grant };
}
