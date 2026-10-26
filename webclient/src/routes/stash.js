import { Router } from 'express';
import { ApiError } from '../apiClient.js';
import { requireLogin } from '../middleware/session.js';
import { findItem, otherContainer, CONTAINER_LABELS } from '../view.js';

const CONTAINERS = Object.keys(CONTAINER_LABELS);

// Form fields arrive as strings; send numbers to the API and drop empty fields.
function int(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) ? n : value; // let the API reject anything odd
}

function friendlyMessage(err) {
  if (err.code === 'INVENTORY_CONFLICT') {
    return 'Your inventory changed while this page was open (maybe in game). This is the latest version: try again.';
  }
  return err.message;
}

export function stashRoutes() {
  const r = Router();
  r.use(['/stash', '/items'], requireLogin);

  r.get('/stash', async (req, res) => {
    const view = CONTAINERS.includes(req.query.view) ? req.query.view : 'stash';
    const inventory = await req.api.inventory();
    res.render('stash', { title: CONTAINER_LABELS[view], view, inventory });
  });

  r.get('/items/:id', async (req, res) => {
    const inventory = await req.api.inventory();
    const item = findItem(inventory, Number(req.params.id));
    if (!item) {
      res.flash('info', 'That item is no longer in your inventory.');
      return res.redirect('/stash');
    }
    const to = CONTAINERS.includes(req.query.to) ? req.query.to : otherContainer(item.container);
    res.render('item', { title: item.item.name, inventory, it: item, to });
  });

  // Runs one inventory action, then redirects: back to the item if it still exists,
  // otherwise to the container it was in. Rule errors become a flash message.
  function action(name, buildBody, successText) {
    return async (req, res) => {
      const itemId = Number(req.params.id);
      const from = CONTAINERS.includes(req.body.from) ? req.body.from : 'stash';
      try {
        const body = { itemId, revision: int(req.body.revision), ...buildBody(req.body) };
        const { inventory, result } = await req.api[name](body);
        res.flash('success', successText(result, req.body));
        const still = findItem(inventory, itemId);
        res.redirect(still ? `/items/${itemId}` : `/stash?view=${from}`);
      } catch (err) {
        if (!(err instanceof ApiError) || err.status === 401 || err.status >= 500) throw err;
        res.flash('error', friendlyMessage(err));
        res.redirect(`/items/${itemId}`);
      }
    };
  }

  r.post(
    '/items/:id/move',
    action(
      'move',
      (b) => ({ container: CONTAINERS.includes(b.container) ? b.container : undefined, slot: int(b.slot), quantity: int(b.quantity) }),
      (result, b) => {
        const where = CONTAINER_LABELS[b.container] ?? 'Stash';
        return b.slot ? `Moved ${result.moved} to ${where}, slot ${Number(b.slot) + 1}.` : `Moved ${result.moved} to your ${where.toLowerCase()}.`;
      },
    ),
  );

  r.post('/items/:id/split', action('split', (b) => ({ quantity: int(b.quantity) }), (result) => `Split into slot ${result.slot + 1}.`));

  r.post('/items/:id/sell', action('sell', (b) => ({ quantity: int(b.quantity) }), (result) => `Sold ${result.sold} for ${result.credits} credits.`));

  r.post('/items/:id/discard', async (req, res, next) => {
    if (req.body.confirm !== 'yes') {
      res.flash('error', 'Tick the box to confirm you want to throw it away.');
      return res.redirect(`/items/${Number(req.params.id)}`);
    }
    return action('discard', (b) => ({ quantity: int(b.quantity) }), (result) => `Threw away ${result.discarded}.`)(req, res, next);
  });

  r.post('/stash/sort', async (req, res) => {
    const container = CONTAINERS.includes(req.body.container) ? req.body.container : 'stash';
    try {
      await req.api.sort({ container, revision: int(req.body.revision) });
      res.flash('success', `${CONTAINER_LABELS[container]} sorted.`);
    } catch (err) {
      if (!(err instanceof ApiError) || err.status === 401 || err.status >= 500) throw err;
      res.flash('error', friendlyMessage(err));
    }
    res.redirect(`/stash?view=${container}`);
  });

  return r;
}
