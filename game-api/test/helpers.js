import { Catalog, toItemDef } from '../src/game/catalog.js';
import { Inventory } from '../src/game/inventory.js';

const row = (id, code, category, maxStack, extra = {}) => ({
  id,
  code,
  name: code,
  description: '',
  category,
  rarity: 'common',
  max_stack: maxStack,
  sell_price: 10,
  is_sellable: 1,
  is_discardable: 1,
  loadout_allowed: 1,
  asset_path: null,
  ...extra,
});

export const catalog = new Catalog(
  [
    row(1, 'rifle', 'weapon', 1, { sell_price: 300 }),
    row(2, 'ammo', 'ammo', 100, { sell_price: 2 }),
    row(3, 'medkit', 'consumable', 5, { rarity: 'uncommon' }),
    row(4, 'keycard', 'quest', 1, { is_sellable: 0, is_discardable: 0 }),
    row(5, 'scrap', 'material', 50, { loadout_allowed: 0 }),
    row(6, 'smg', 'weapon', 1, { rarity: 'rare' }),
  ].map(toItemDef),
);

export const def = (code) => catalog.byCode(code);

let nextId = 1000;
export function item(code, container, slot, quantity = 1) {
  return { id: nextId++, defId: def(code).id, container, slot, quantity };
}

export function inventory(items, { stash = 10, loadout = 4, inMatch = false } = {}) {
  return new Inventory({ items, capacity: { stash, loadout }, inMatch, catalog });
}

export const view = (inv, container) =>
  inv
    .inContainer(container)
    .map((i) => `${i.slot}:${catalog.byId(i.defId).code}x${i.quantity}`)
    .join(' ');
