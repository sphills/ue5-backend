import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { diffItems } from '../src/game/inventory.js';
import { def, item, inventory, view } from './helpers.js';

const rejects = (fn, code) => assert.throws(fn, (err) => err.code === code, `expected ${code}`);

describe('move', () => {
  test('moves a whole stack to an empty slot', () => {
    const a = item('ammo', 'stash', 0, 40);
    const inv = inventory([a]);
    inv.move(a.id, { container: 'stash', slot: 5 });
    assert.equal(view(inv, 'stash'), '5:ammox40');
    assert.equal(inv.events[0].action, 'move');
  });

  test('moving part of a stack to an empty slot splits it', () => {
    const a = item('ammo', 'stash', 0, 40);
    const inv = inventory([a]);
    inv.move(a.id, { container: 'loadout', slot: 1, quantity: 15 });
    assert.equal(view(inv, 'stash'), '0:ammox25');
    assert.equal(view(inv, 'loadout'), '1:ammox15');
  });

  test('stacks onto the same item only as far as it fits', () => {
    const a = item('ammo', 'stash', 0, 70);
    const b = item('ammo', 'stash', 1, 50);
    const inv = inventory([a, b]);
    const res = inv.move(a.id, { slot: 1 });
    assert.equal(res.moved, 50);
    assert.equal(view(inv, 'stash'), '0:ammox20 1:ammox100');
  });

  test('a fully merged source stack disappears', () => {
    const a = item('ammo', 'stash', 0, 30);
    const b = item('ammo', 'stash', 1, 50);
    const inv = inventory([a, b]);
    inv.move(a.id, { slot: 1 });
    assert.equal(view(inv, 'stash'), '1:ammox80');
  });

  test('refuses to stack onto a full stack', () => {
    const a = item('ammo', 'stash', 0, 10);
    const b = item('ammo', 'stash', 1, 100);
    rejects(() => inventory([a, b]).move(a.id, { slot: 1 }), 'STACK_FULL');
  });

  test('swaps two different items, across containers', () => {
    const r = item('rifle', 'stash', 0);
    const s = item('smg', 'loadout', 0);
    const inv = inventory([r, s]);
    inv.move(r.id, { container: 'loadout', slot: 0 });
    assert.equal(view(inv, 'stash'), '0:smgx1');
    assert.equal(view(inv, 'loadout'), '0:riflex1');
  });

  test('cannot swap part of a stack', () => {
    const a = item('ammo', 'stash', 0, 40);
    const r = item('rifle', 'stash', 1);
    rejects(() => inventory([a, r]).move(a.id, { slot: 1, quantity: 10 }), 'SLOT_OCCUPIED');
  });

  test('items flagged out of the loadout cannot go in, even through a swap', () => {
    const s = item('scrap', 'stash', 0, 10);
    rejects(() => inventory([s]).move(s.id, { container: 'loadout', slot: 0 }), 'NOT_ALLOWED_IN_LOADOUT');

    const r = item('rifle', 'loadout', 0);
    const s2 = item('scrap', 'stash', 3, 5);
    rejects(() => inventory([r, s2]).move(r.id, { container: 'stash', slot: 3 }), 'NOT_ALLOWED_IN_LOADOUT');
  });

  test('slot must be inside the container', () => {
    const a = item('rifle', 'stash', 0);
    rejects(() => inventory([a]).move(a.id, { container: 'loadout', slot: 4 }), 'INVALID_SLOT');
  });

  test('quantity cannot exceed the stack', () => {
    const a = item('ammo', 'stash', 0, 5);
    rejects(() => inventory([a]).move(a.id, { slot: 3, quantity: 6 }), 'INVALID_QUANTITY');
  });

  test('unknown item id', () => {
    rejects(() => inventory([]).move(999999, { slot: 1 }), 'ITEM_NOT_FOUND');
  });

  test('moving onto itself changes nothing', () => {
    const a = item('rifle', 'stash', 2);
    const inv = inventory([a]);
    inv.move(a.id, { slot: 2 });
    assert.equal(inv.changed, false);
  });
});

describe('auto-place (move without a slot)', () => {
  test('tops up matching stacks, then uses the first empty slot', () => {
    const src = item('ammo', 'stash', 0, 100);
    const dst = item('ammo', 'loadout', 2, 70);
    const inv = inventory([src, dst]);
    inv.move(src.id, { container: 'loadout' });
    assert.equal(view(inv, 'loadout'), '0:ammox70 2:ammox100');
    assert.equal(view(inv, 'stash'), '');
  });

  test('fails cleanly when nothing fits', () => {
    const items = [0, 1, 2, 3].map((s) => item('rifle', 'loadout', s));
    const r = item('rifle', 'stash', 0);
    const inv = inventory([...items, r]);
    rejects(() => inv.move(r.id, { container: 'loadout' }), 'LOADOUT_FULL');
  });

  test('requires a slot within the same container', () => {
    const r = item('rifle', 'stash', 0);
    rejects(() => inventory([r]).move(r.id, {}), 'SLOT_REQUIRED');
  });
});

describe('match lock', () => {
  test('the loadout is locked for players during a match, the stash is not', () => {
    const r = item('rifle', 'loadout', 0);
    const a = item('ammo', 'stash', 0, 10);
    const inv = inventory([r, a], { inMatch: true });
    rejects(() => inv.move(r.id, { container: 'stash', slot: 5 }), 'LOADOUT_LOCKED');
    rejects(() => inv.move(a.id, { container: 'loadout', slot: 1 }), 'LOADOUT_LOCKED');
    rejects(() => inv.sell(r.id), 'LOADOUT_LOCKED');
    rejects(() => inv.sort('loadout'), 'LOADOUT_LOCKED');
    inv.move(a.id, { slot: 3 });
    assert.equal(view(inv, 'stash'), '3:ammox10');
  });

  test('the server can still change the loadout', () => {
    const r = item('rifle', 'loadout', 0);
    const inv = inventory([r], { inMatch: true });
    inv.move(r.id, { container: 'stash', slot: 0 }, 'server');
    assert.equal(view(inv, 'stash'), '0:riflex1');
  });
});

describe('split, discard, sell', () => {
  test('split goes to the first empty slot', () => {
    const a = item('ammo', 'stash', 0, 50);
    const b = item('rifle', 'stash', 1);
    const inv = inventory([a, b]);
    assert.deepEqual(inv.split(a.id, 20), { slot: 2 });
    assert.equal(view(inv, 'stash'), '0:ammox30 1:riflex1 2:ammox20');
  });

  test('cannot split a single item or the whole stack', () => {
    const r = item('rifle', 'stash', 0);
    rejects(() => inventory([r]).split(r.id, 1), 'CANNOT_SPLIT');
    const a = item('ammo', 'stash', 0, 5);
    rejects(() => inventory([a]).split(a.id, 5), 'INVALID_QUANTITY');
  });

  test('split needs a free slot', () => {
    const a = item('ammo', 'stash', 0, 5);
    const b = item('rifle', 'stash', 1);
    rejects(() => inventory([a, b], { stash: 2 }).split(a.id, 2), 'STASH_FULL');
  });

  test('discard part or all of a stack', () => {
    const a = item('ammo', 'stash', 0, 50);
    const inv = inventory([a]);
    inv.discard(a.id, 20);
    assert.equal(view(inv, 'stash'), '0:ammox30');
    inv.discard(a.id);
    assert.equal(view(inv, 'stash'), '');
  });

  test('quest items cannot be discarded or sold', () => {
    const k = item('keycard', 'stash', 0);
    rejects(() => inventory([k]).discard(k.id), 'NOT_DISCARDABLE');
    rejects(() => inventory([k]).sell(k.id), 'NOT_SELLABLE');
  });

  test('selling pays sellPrice × quantity', () => {
    const a = item('ammo', 'stash', 0, 50);
    const inv = inventory([a]);
    assert.deepEqual(inv.sell(a.id, 30), { sold: 30, credits: 60 });
    assert.equal(inv.creditsDelta, 60);
    assert.equal(view(inv, 'stash'), '0:ammox20');
  });
});

describe('sort', () => {
  test('merges partial stacks, orders by category then rarity, packs from slot 0', () => {
    const items = [
      item('ammo', 'stash', 9, 60),
      item('medkit', 'stash', 2, 3),
      item('ammo', 'stash', 4, 60),
      item('rifle', 'stash', 7),
      item('smg', 'stash', 1),
      item('medkit', 'stash', 3, 1),
      item('rifle', 'loadout', 0),
    ];
    const inv = inventory(items);
    inv.sort('stash');
    // weapons (rare smg before common rifle), then ammo, then consumables
    assert.equal(view(inv, 'stash'), '0:smgx1 1:riflex1 2:ammox100 3:ammox20 4:medkitx4');
    assert.equal(view(inv, 'loadout'), '0:riflex1');
  });

  test('reuses existing row ids so the database diff stays small', () => {
    const a = item('ammo', 'stash', 3, 30);
    const b = item('ammo', 'stash', 5, 30);
    const original = [a, b].map((i) => ({ ...i }));
    const inv = inventory([a, b]);
    inv.sort('stash');
    const diff = diffItems(original, inv.items);
    assert.equal(diff.inserts.length, 0);
    assert.deepEqual(diff.deletes, [b.id]);
    assert.equal(diff.updates.length, 1);
    assert.equal(diff.updates[0].item.quantity, 60);
    assert.equal(diff.updates[0].item.slot, 0);
  });
});

describe('grant and consume (server)', () => {
  test('fills existing stacks, then empty slots, splitting by max stack', () => {
    const a = item('ammo', 'stash', 0, 90);
    const b = item('rifle', 'stash', 1);
    const inv = inventory([a, b]);
    const res = inv.grant([{ def: def('ammo'), quantity: 230 }]);
    assert.deepEqual(res.delivered, [{ itemCode: 'ammo', quantity: 230 }]);
    assert.equal(view(inv, 'stash'), '0:ammox100 1:riflex1 2:ammox100 3:ammox100 4:ammox20');
  });

  test('strict grants are all or nothing', () => {
    const inv = inventory([item('rifle', 'stash', 0)], { stash: 2 });
    rejects(() => inv.grant([{ def: def('rifle'), quantity: 2 }]), 'STASH_FULL');
  });

  test('partial grants deliver what fits and report the rest', () => {
    const inv = inventory([item('rifle', 'stash', 0)], { stash: 2 });
    const res = inv.grant([{ def: def('rifle'), quantity: 3 }], { partial: true });
    assert.deepEqual(res.delivered, [{ itemCode: 'rifle', quantity: 1 }]);
    assert.deepEqual(res.undelivered, [{ itemCode: 'rifle', quantity: 2 }]);
  });

  test('consume ignores the match lock', () => {
    const r = item('ammo', 'loadout', 0, 60);
    const inv = inventory([r], { inMatch: true });
    inv.consume(r.id, 45);
    assert.equal(view(inv, 'loadout'), '0:ammox15');
  });
});

describe('diffItems', () => {
  test('classifies inserts, moves, quantity changes and deletes', () => {
    const original = [
      { id: 1, defId: 2, container: 'stash', slot: 0, quantity: 10 },
      { id: 2, defId: 2, container: 'stash', slot: 1, quantity: 10 },
      { id: 3, defId: 1, container: 'stash', slot: 2, quantity: 1 },
    ];
    const final = [
      { id: 1, defId: 2, container: 'stash', slot: 0, quantity: 20 },
      { id: 3, defId: 1, container: 'loadout', slot: 0, quantity: 1 },
      { id: null, defId: 3, container: 'stash', slot: 5, quantity: 2 },
    ];
    const d = diffItems(original, final);
    assert.deepEqual(d.deletes, [2]);
    assert.equal(d.inserts.length, 1);
    assert.deepEqual(
      d.updates.map((u) => [u.item.id, u.moved]),
      [
        [1, false],
        [3, true],
      ],
    );
  });
});
