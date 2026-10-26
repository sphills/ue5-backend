import { Router } from 'express';
import { itemDefView } from '../services/inventoryService.js';

export function publicRoutes({ db, catalog }) {
  const r = Router();

  r.get('/health', async (req, res) => {
    try {
      await db.ping();
      res.json({ status: 'ok', db: 'ok' });
    } catch {
      res.status(503).json({ status: 'degraded', db: 'unreachable' });
    }
  });

  // Item catalog. Public so the UE5 client can cache it at startup; Express adds an ETag,
  // so clients sending If-None-Match get a 304 when nothing changed.
  r.get('/v1/items', async (req, res) => {
    const cat = await catalog.get();
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ items: cat.all().map(itemDefView) });
  });

  return r;
}
