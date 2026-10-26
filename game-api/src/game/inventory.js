// The inventory rules engine. Pure JavaScript, no database: it takes a snapshot of one
// player's items, applies one operation, and leaves the changed snapshot behind. The
// service layer loads the snapshot inside a locked transaction and writes back the diff.
//
// Items: { id, defId, container, slot, quantity }   (id is null for rows not yet inserted)

import { ruleError, badRequest } from '../errors.js';
import { RULES } from './rules.js';

export class Inventory {
  /**
   * @param {object} p
   * @param {Array}  p.items       current rows for this account
   * @param {object} p.capacity    { stash: n, loadout: n }
   * @param {boolean} p.inMatch    a dedicated server has this player in a match
   * @param {import('./catalog.js').Catalog} p.catalog
   */
  constructor({ items, capacity, inMatch = false, catalog }) {
    this.items = items.map((i) => ({ ...i }));
    this.capacity = { ...capacity };
    this.inMatch = inMatch;
    this.catalog = catalog;
    this.creditsDelta = 0;
    this.events = [];
  }

  // ---------- lookups ----------

  def(item) {
    const def = this.catalog.byId(item.defId);
    if (!def) throw new Error(`Unknown item definition ${item.defId}`);
    return def;
  }

  find(itemId) {
    const item = this.items.find((i) => i.id === itemId);
    if (!item) throw ruleError('ITEM_NOT_FOUND', 'That item is not in your inventory');
    return item;
  }

  at(container, slot) {
    return this.items.find((i) => i.container === container && i.slot === slot);
  }

  inContainer(container) {
    return this.items.filter((i) => i.container === container).sort((a, b) => a.slot - b.slot);
  }

  firstEmptySlot(container) {
    const used = new Set(this.inContainer(container).map((i) => i.slot));
    for (let s = 0; s < this.capacity[container]; s++) if (!used.has(s)) return s;
    return null;
  }

  freeSlots(container) {
    return this.capacity[container] - this.inContainer(container).length;
  }

  // ---------- guards ----------

  assertContainer(container) {
    if (!RULES.containers.includes(container)) {
      throw badRequest('INVALID_CONTAINER', `Container must be one of: ${RULES.containers.join(', ')}`);
    }
  }

  assertWritable(container, actor) {
    if (container === 'loadout' && this.inMatch && actor !== 'server') {
      throw ruleError('LOADOUT_LOCKED', 'Your loadout is locked while you are in a match');
    }
  }

  assertSlot(container, slot) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.capacity[container]) {
      throw badRequest('INVALID_SLOT', `Slot must be between 0 and ${this.capacity[container] - 1}`);
    }
  }

  assertAllowedIn(def, container) {
    if (container === 'loadout' && !def.loadoutAllowed) {
      throw ruleError('NOT_ALLOWED_IN_LOADOUT', `${def.name} can't be taken into a match`);
    }
  }

  assertQuantity(quantity, max) {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > max) {
      throw badRequest('INVALID_QUANTITY', `Quantity must be between 1 and ${max}`);
    }
  }

  // ---------- internal mutation helpers ----------

  take(item, quantity) {
    item.quantity -= quantity;
    if (item.quantity === 0) this.items.splice(this.items.indexOf(item), 1);
  }

  record(action, item, quantity, extra = {}) {
    this.events.push({ action, itemDefId: item?.defId ?? null, quantity, ...extra });
  }

  // ---------- player operations ----------

  /**
   * Move a whole stack, or `quantity` of it, to (container, slot).
   *  - empty target: the items move there
   *  - same item with room: they stack (only as many as fit; the rest stays put)
   *  - different item: the two stacks swap (whole stacks only)
   * With no slot, the items go to the other container automatically: onto matching
   * stacks first, then the first empty slot.
   */
  move(itemId, { container, slot, quantity } = {}, actor = 'player') {
    const src = this.find(itemId);
    const def = this.def(src);
    const target = container ?? src.container;
    this.assertContainer(target);
    const qty = quantity ?? src.quantity;
    this.assertQuantity(qty, src.quantity);
    this.assertWritable(src.container, actor);
    this.assertWritable(target, actor);
    this.assertAllowedIn(def, target);

    if (slot === undefined || slot === null) return this.autoPlace(src, def, target, qty);

    this.assertSlot(target, slot);
    if (src.container === target && src.slot === slot) return { moved: 0 };

    const from = { container: src.container, slot: src.slot };
    const occupant = this.at(target, slot);

    if (!occupant) {
      if (qty === src.quantity) {
        src.container = target;
        src.slot = slot;
      } else {
        this.take(src, qty);
        this.items.push({ id: null, defId: src.defId, container: target, slot, quantity: qty });
      }
      this.record('move', src, qty, { from, to: { container: target, slot } });
      return { moved: qty };
    }

    if (occupant.defId === src.defId) {
      const room = def.maxStack - occupant.quantity;
      if (room <= 0) throw ruleError('STACK_FULL', `That stack of ${def.name} is already full`);
      const n = Math.min(room, qty);
      occupant.quantity += n;
      this.take(src, n);
      this.record('stack', src, n, { from, to: { container: target, slot } });
      return { moved: n };
    }

    if (qty !== src.quantity) {
      throw ruleError('SLOT_OCCUPIED', 'That slot holds a different item; move the whole stack to swap them');
    }
    const otherDef = this.def(occupant);
    this.assertAllowedIn(otherDef, src.container);
    occupant.container = src.container;
    occupant.slot = src.slot;
    src.container = target;
    src.slot = slot;
    this.record('swap', src, qty, { from, to: { container: target, slot }, swappedWith: occupant.defId });
    return { moved: qty };
  }

  autoPlace(src, def, target, qty) {
    if (target === src.container) {
      throw badRequest('SLOT_REQUIRED', 'Pick a slot to move an item within the same container');
    }
    const stacks = this.inContainer(target).filter((i) => i.defId === src.defId && i.quantity < def.maxStack);
    const stackRoom = stacks.reduce((sum, i) => sum + (def.maxStack - i.quantity), 0);
    const emptySlot = this.firstEmptySlot(target);
    if (stackRoom < qty && emptySlot === null) {
      throw ruleError(target === 'stash' ? 'STASH_FULL' : 'LOADOUT_FULL', `Your ${target} has no room for that`);
    }

    const from = { container: src.container, slot: src.slot };
    let remaining = qty;
    for (const stack of stacks) {
      if (remaining === 0) break;
      const n = Math.min(def.maxStack - stack.quantity, remaining);
      stack.quantity += n;
      remaining -= n;
    }
    const placed = qty - remaining;
    if (placed > 0) this.take(src, placed);
    if (remaining > 0) {
      if (remaining === src.quantity) {
        src.container = target;
        src.slot = emptySlot;
      } else {
        this.take(src, remaining);
        this.items.push({ id: null, defId: src.defId, container: target, slot: emptySlot, quantity: remaining });
      }
    }
    this.record('move', src, qty, { from, to: { container: target } });
    return { moved: qty };
  }

  /** Split `quantity` off a stack into the first empty slot of the same container. */
  split(itemId, quantity, actor = 'player') {
    const src = this.find(itemId);
    this.assertWritable(src.container, actor);
    if (src.quantity < 2) throw ruleError('CANNOT_SPLIT', 'There is only one item in that stack');
    this.assertQuantity(quantity, src.quantity - 1);
    const slot = this.firstEmptySlot(src.container);
    if (slot === null) throw ruleError(src.container === 'stash' ? 'STASH_FULL' : 'LOADOUT_FULL', `Your ${src.container} has no empty slot`);
    this.take(src, quantity);
    this.items.push({ id: null, defId: src.defId, container: src.container, slot, quantity });
    this.record('split', src, quantity, { to: { container: src.container, slot } });
    return { slot };
  }

  discard(itemId, quantity, actor = 'player') {
    const item = this.find(itemId);
    const def = this.def(item);
    this.assertWritable(item.container, actor);
    if (!def.discardable) throw ruleError('NOT_DISCARDABLE', `${def.name} can't be thrown away`);
    const qty = quantity ?? item.quantity;
    this.assertQuantity(qty, item.quantity);
    this.take(item, qty);
    this.record('discard', item, qty);
    return { discarded: qty };
  }

  sell(itemId, quantity, actor = 'player') {
    const item = this.find(itemId);
    const def = this.def(item);
    this.assertWritable(item.container, actor);
    if (!def.sellable) throw ruleError('NOT_SELLABLE', `${def.name} can't be sold`);
    const qty = quantity ?? item.quantity;
    this.assertQuantity(qty, item.quantity);
    const credits = def.sellPrice * qty;
    this.take(item, qty);
    this.creditsDelta += credits;
    this.record('sell', item, qty, { creditsDelta: credits });
    return { sold: qty, credits };
  }

  /** Merge partial stacks of the same item and pack everything into the lowest slots. */
  sort(container, actor = 'player') {
    this.assertContainer(container);
    this.assertWritable(container, actor);
    const rows = this.inContainer(container);
    if (rows.length === 0) return { stacks: 0 };

    const groups = new Map();
    for (const row of rows) {
      if (!groups.has(row.defId)) groups.set(row.defId, []);
      groups.get(row.defId).push(row);
    }

    const cat = (d) => RULES.categoryOrder.indexOf(d.category);
    const rar = (d) => RULES.rarityOrder.indexOf(d.rarity);
    const order = [...groups.keys()]
      .map((id) => this.catalog.byId(id))
      .sort((a, b) => cat(a) - cat(b) || rar(a) - rar(b) || a.name.localeCompare(b.name) || a.id - b.id);

    const keep = [];
    for (const def of order) {
      const group = groups.get(def.id); // already in slot order, so existing row ids are reused
      let total = group.reduce((sum, r) => sum + r.quantity, 0);
      for (const row of group) {
        if (total === 0) {
          this.items.splice(this.items.indexOf(row), 1);
          continue;
        }
        row.quantity = Math.min(def.maxStack, total);
        total -= row.quantity;
        keep.push(row);
      }
    }
    keep.forEach((row, slot) => {
      row.slot = slot;
    });
    this.record('sort', null, 0, { container });
    return { stacks: keep.length };
  }

  // ---------- server-authoritative operations ----------

  /**
   * Add items to a container: topping up existing stacks first, then filling empty slots.
   * strict (default): all or nothing, throws STASH_FULL if it doesn't all fit.
   * partial: delivers what fits and reports the rest as undelivered.
   */
  grant(entries, { container = 'stash', partial = false, reason = null } = {}) {
    this.assertContainer(container);
    const delivered = [];
    const undelivered = [];
    for (const { def, quantity } of entries) {
      this.assertAllowedIn(def, container);
      let remaining = quantity;
      for (const stack of this.inContainer(container)) {
        if (remaining === 0) break;
        if (stack.defId !== def.id || stack.quantity >= def.maxStack) continue;
        const n = Math.min(def.maxStack - stack.quantity, remaining);
        stack.quantity += n;
        remaining -= n;
      }
      while (remaining > 0) {
        const slot = this.firstEmptySlot(container);
        if (slot === null) break;
        const n = Math.min(def.maxStack, remaining);
        this.items.push({ id: null, defId: def.id, container, slot, quantity: n });
        remaining -= n;
      }
      if (remaining > 0 && !partial) {
        throw ruleError(container === 'stash' ? 'STASH_FULL' : 'LOADOUT_FULL', `Not enough room in the ${container} for ${quantity} × ${def.name}`, {
          itemCode: def.code,
          undelivered: remaining,
        });
      }
      const got = quantity - remaining;
      if (got > 0) {
        delivered.push({ itemCode: def.code, quantity: got });
        this.events.push({ action: 'grant', itemDefId: def.id, quantity: got, reason });
      }
      if (remaining > 0) undelivered.push({ itemCode: def.code, quantity: remaining });
    }
    return { delivered, undelivered };
  }

  /** Remove items that were used up or lost in a match. Never fails on locks. */
  consume(itemId, quantity, reason = null) {
    const item = this.find(itemId);
    const qty = quantity ?? item.quantity;
    this.assertQuantity(qty, item.quantity);
    this.take(item, qty);
    this.events.push({ action: 'consume', itemDefId: item.defId, quantity: qty, reason });
    return { consumed: qty };
  }

  addCredits(amount, reason = null) {
    if (!Number.isInteger(amount) || amount < 0) throw badRequest('INVALID_CREDITS', 'Credits must be a non-negative integer');
    if (amount === 0) return;
    this.creditsDelta += amount;
    this.events.push({ action: 'credits', itemDefId: null, quantity: 0, creditsDelta: amount, reason });
  }

  get changed() {
    return this.events.length > 0;
  }
}

/**
 * Compare the rows loaded from the database with the engine's final state and return the
 * SQL-level changes needed. Pure, so it can be unit-tested.
 */
export function diffItems(originalRows, finalItems) {
  const byId = new Map(originalRows.map((r) => [r.id, r]));
  const seen = new Set();
  const inserts = [];
  const updates = [];
  for (const item of finalItems) {
    if (item.id === null || item.id === undefined) {
      inserts.push(item);
      continue;
    }
    seen.add(item.id);
    const before = byId.get(item.id);
    const moved = before.container !== item.container || before.slot !== item.slot;
    if (moved || before.quantity !== item.quantity) updates.push({ item, moved });
  }
  const deletes = originalRows.filter((r) => !seen.has(r.id)).map((r) => r.id);
  return { inserts, updates, deletes };
}
