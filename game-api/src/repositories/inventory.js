// SQL for inventory_items, inventory_events and item_definitions.
import { diffItems } from '../game/inventory.js';

// Rows that move are first parked at slots above any real capacity, so swaps and
// re-sorts never trip the UNIQUE (account_id, container, slot) key mid-update.
const PARK_BASE = 60000;

export async function loadItemDefinitions(q) {
  return q.query(
    `SELECT id, code, name, description, category, rarity, max_stack, sell_price,
            is_sellable, is_discardable, loadout_allowed, asset_path
       FROM item_definitions ORDER BY id`,
  );
}

export async function loadItems(q, accountId) {
  const rows = await q.query(
    `SELECT id, item_def_id, container, slot, quantity, acquired_at
       FROM inventory_items WHERE account_id = ? ORDER BY container, slot`,
    [accountId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    defId: Number(r.item_def_id),
    container: r.container,
    slot: Number(r.slot),
    quantity: Number(r.quantity),
    acquiredAt: r.acquired_at,
  }));
}

/** Write the engine's final state back: deletes, parked moves, updates, then inserts. */
export async function saveItems(q, accountId, originalRows, finalItems) {
  const { inserts, updates, deletes } = diffItems(originalRows, finalItems);

  if (deletes.length) {
    await q.query('DELETE FROM inventory_items WHERE account_id = ? AND id IN (?)', [accountId, deletes]);
  }

  const moved = updates.filter((u) => u.moved);
  for (let i = 0; i < moved.length; i++) {
    await q.query('UPDATE inventory_items SET slot = ? WHERE id = ? AND account_id = ?', [PARK_BASE + i, moved[i].item.id, accountId]);
  }
  for (const { item } of updates) {
    await q.query(
      'UPDATE inventory_items SET container = ?, slot = ?, quantity = ? WHERE id = ? AND account_id = ?',
      [item.container, item.slot, item.quantity, item.id, accountId],
    );
  }

  if (inserts.length) {
    await q.query(
      'INSERT INTO inventory_items (account_id, item_def_id, container, slot, quantity) VALUES ?',
      [inserts.map((i) => [accountId, i.defId, i.container, i.slot, i.quantity])],
    );
  }
  return { inserted: inserts.length, updated: updates.length, deleted: deletes.length };
}

export async function insertEvents(q, accountId, events, { actor, sessionId = null, reason = null }) {
  if (events.length === 0) return;
  await q.query(
    'INSERT INTO inventory_events (account_id, action, item_def_id, quantity, credits_delta, actor, session_id, reason) VALUES ?',
    [
      events.map((e) => [
        accountId,
        e.action,
        e.itemDefId ?? null,
        e.quantity ?? 0,
        e.creditsDelta ?? 0,
        actor,
        sessionId,
        (e.reason ?? reason)?.slice(0, 128) ?? null,
      ]),
    ],
  );
}

export async function listEvents(q, accountId, limit = 50) {
  return q.query(
    `SELECT id, action, item_def_id, quantity, credits_delta, actor, reason, created_at
       FROM inventory_events WHERE account_id = ? ORDER BY id DESC LIMIT ?`,
    [accountId, limit],
  );
}
