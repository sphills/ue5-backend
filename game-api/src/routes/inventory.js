import { Router } from 'express';
import { parse, fields, v } from '../validate.js';
import { RULES } from '../game/rules.js';

// Every player write accepts an optional `revision` (from the last inventory read). If the
// inventory changed in between (game client, another tab, end of a match), the API answers
// 409 INVENTORY_CONFLICT with the current revision instead of acting on stale data.
const container = v.oneOf(RULES.containers);
const slot = v.int({ min: 0, max: RULES.maxStashSlots - 1 });
const quantity = v.int({ min: 1, max: 1_000_000 });

export function inventoryRoutes({ inventory }) {
  const r = Router();

  const mutate = (req, op) => {
    const { revision } = parse({ revision: fields.revision.optional() }, req.body);
    return inventory.mutate(req.auth.accountId, { actor: 'player', sessionId: req.auth.sessionId, expectedRevision: revision }, op);
  };

  r.get('/', async (req, res) => {
    res.json(await inventory.getInventory(req.auth.accountId));
  });

  // { itemId, container?, slot?, quantity?, revision? }  no slot = auto-place in the other container
  r.post('/move', async (req, res) => {
    const input = parse(
      { itemId: fields.id, container: container.optional(), slot: slot.optional(), quantity: quantity.optional() },
      req.body,
    );
    res.json(await mutate(req, (engine) => engine.move(input.itemId, input)));
  });

  // { itemId, quantity, revision? }  splits into the first empty slot of the same container
  r.post('/split', async (req, res) => {
    const input = parse({ itemId: fields.id, quantity }, req.body);
    res.json(await mutate(req, (engine) => engine.split(input.itemId, input.quantity)));
  });

  // { itemId, quantity?, revision? }  no quantity = the whole stack
  r.post('/discard', async (req, res) => {
    const input = parse({ itemId: fields.id, quantity: quantity.optional() }, req.body);
    res.json(await mutate(req, (engine) => engine.discard(input.itemId, input.quantity)));
  });

  r.post('/sell', async (req, res) => {
    const input = parse({ itemId: fields.id, quantity: quantity.optional() }, req.body);
    res.json(await mutate(req, (engine) => engine.sell(input.itemId, input.quantity)));
  });

  // { container, revision? }
  r.post('/sort', async (req, res) => {
    const input = parse({ container }, req.body);
    res.json(await mutate(req, (engine) => engine.sort(input.container)));
  });

  return r;
}
