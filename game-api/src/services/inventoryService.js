// Inventory reads and writes. Every write:
//   1. locks the account row (SELECT ... FOR UPDATE) so one player's operations are serialised
//      across the game client, the WebClient and dedicated servers;
//   2. optionally checks the client's `revision` to reject stale requests (409 INVENTORY_CONFLICT);
//   3. runs the pure rules engine, then writes the diff, the credit change and audit events.
import * as accounts from '../repositories/accounts.js';
import * as inv from '../repositories/inventory.js';
import { Inventory } from '../game/inventory.js';
import { RULES } from '../game/rules.js';
import { conflict, notFound } from '../errors.js';

export const MAX_MATCH_SECONDS = Math.floor(RULES.maxMatchDurationMs / 1000);

export function itemDefView(def) {
  return {
    code: def.code,
    name: def.name,
    description: def.description,
    category: def.category,
    rarity: def.rarity,
    maxStack: def.maxStack,
    sellPrice: def.sellPrice,
    sellable: def.sellable,
    discardable: def.discardable,
    loadoutAllowed: def.loadoutAllowed,
    assetPath: def.assetPath,
  };
}

export function buildInventoryView(account, items, catalog) {
  const inMatch = Boolean(Number(account.in_match));
  const containers = {};
  for (const name of RULES.containers) {
    const rows = items.filter((i) => i.container === name).sort((a, b) => a.slot - b.slot);
    containers[name] = {
      capacity: name === 'stash' ? Number(account.stash_slots) : RULES.loadoutSlots,
      used: rows.length,
      locked: name === 'loadout' && inMatch,
      items: rows.map((r) => ({
        id: r.id,
        slot: r.slot,
        quantity: r.quantity,
        acquiredAt: r.acquiredAt ?? null,
        item: itemDefView(catalog.byId(r.defId)),
      })),
    };
  }
  return {
    accountId: Number(account.id),
    revision: Number(account.inventory_revision),
    credits: Number(account.credits),
    inMatch,
    containers,
  };
}

export function createInventoryService({ db, catalog }) {
  async function getInventory(accountId) {
    const cat = await catalog.get();
    const account = await accounts.findById(db, accountId, MAX_MATCH_SECONDS);
    if (!account) throw notFound('ACCOUNT_NOT_FOUND', 'Account not found');
    const items = await inv.loadItems(db, accountId);
    return buildInventoryView(account, items, cat);
  }

  /**
   * Run `op(engine, account, tx)` against a locked snapshot of the player's inventory.
   * @returns {{ result: any, inventory: object }}
   */
  async function mutate(accountId, { actor = 'player', sessionId = null, expectedRevision, reason = null } = {}, op) {
    const cat = await catalog.get();
    return db.transaction(async (tx) => {
      const account = await accounts.lockById(tx, accountId, MAX_MATCH_SECONDS);
      if (!account) throw notFound('ACCOUNT_NOT_FOUND', 'Account not found');
      const revision = Number(account.inventory_revision);
      if (expectedRevision !== undefined && expectedRevision !== null && expectedRevision !== revision) {
        throw conflict('INVENTORY_CONFLICT', 'Your inventory changed since you last loaded it. Refresh and try again.', { revision });
      }

      const rows = await inv.loadItems(tx, accountId);
      const engine = new Inventory({
        items: rows,
        capacity: { stash: Number(account.stash_slots), loadout: RULES.loadoutSlots },
        inMatch: Boolean(Number(account.in_match)),
        catalog: cat,
      });

      const result = await op(engine, account, tx);

      if (engine.changed) {
        await inv.saveItems(tx, accountId, rows, engine.items);
        await accounts.applyInventoryChange(tx, accountId, engine.creditsDelta);
        await inv.insertEvents(tx, accountId, engine.events, { actor, sessionId, reason });
      }
      const fresh = await accounts.findById(tx, accountId, MAX_MATCH_SECONDS);
      const items = engine.changed ? await inv.loadItems(tx, accountId) : rows;
      return { result: result ?? {}, inventory: buildInventoryView(fresh, items, cat) };
    });
  }

  async function history(accountId, limit) {
    const cat = await catalog.get();
    const rows = await inv.listEvents(db, accountId, limit);
    return rows.map((r) => {
      const def = r.item_def_id ? cat.byId(r.item_def_id) : null;
      return {
        id: Number(r.id),
        action: r.action,
        itemCode: def?.code ?? null,
        itemName: def?.name ?? null,
        quantity: Number(r.quantity),
        creditsDelta: Number(r.credits_delta),
        actor: r.actor,
        reason: r.reason,
        at: r.created_at,
      };
    });
  }

  return { getInventory, mutate, history };
}
