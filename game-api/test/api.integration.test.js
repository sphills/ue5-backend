// End-to-end HTTP test against a real MySQL database.
// Skipped unless TEST_DB_NAME is set. Use a throwaway database, e.g.:
//   TEST_DB_NAME=game_test DB_USER=game DB_PASSWORD=... npm test -w game-api
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const enabled = Boolean(process.env.TEST_DB_NAME);
const SERVER_KEY = 'test-server-key-0123456789-abcdefghij';

let server;
let base;
let db;

before(async () => {
  if (!enabled) return;
  const { config } = await import('../src/config.js');
  const { createDb } = await import('../src/db/pool.js');
  const { migrate } = await import('../src/db/migrations.js');
  const { createApp } = await import('../src/app.js');
  const { createLogger } = await import('../src/logger.js');

  db = createDb({ ...config.db, database: process.env.TEST_DB_NAME });
  await migrate(db, { log: () => {} });
  const app = createApp({
    db,
    config: { ...config, serverKeys: [SERVER_KEY], trustProxy: 'loopback' },
    logger: createLogger({ level: 'silent' }),
  });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!enabled) return;
  await new Promise((resolve) => server.close(resolve));
  await db.close();
});

async function call(method, path, { token, serverKey, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (serverKey) headers['x-server-key'] = serverKey;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test('full player + dedicated server flow over HTTP', { skip: !enabled && 'set TEST_DB_NAME to run' }, async () => {
  const username = `it_${crypto.randomBytes(4).toString('hex')}`;
  const password = 'integration-pass-1';

  assert.equal((await call('GET', '/health')).body.db, 'ok');
  const items = await call('GET', '/v1/items');
  assert.ok(items.body.items.some((i) => i.code === 'ammo_556'));

  // validation + auth errors
  const bad = await call('POST', '/v1/auth/register', { body: { username: 'x', password: '1', client: 'game' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'VALIDATION_ERROR');
  assert.equal((await call('GET', '/v1/inventory')).body.error.code, 'AUTH_REQUIRED');
  assert.equal((await call('GET', '/v1/inventory', { token: 'nope-nope-nope' })).body.error.code, 'SESSION_INVALID');

  // register (auto-login as the game client)
  const reg = await call('POST', '/v1/auth/register', { body: { username, password, client: 'game' } });
  assert.equal(reg.status, 201);
  const token = reg.body.token;
  const accountId = reg.body.account.id;
  assert.equal((await call('GET', '/v1/me', { token })).body.account.username, username);

  // inventory
  let inv = (await call('GET', '/v1/inventory', { token })).body;
  const ammo = inv.containers.stash.items.find((i) => i.item.code === 'ammo_556');
  let res = await call('POST', '/v1/inventory/move', { token, body: { itemId: ammo.id, container: 'loadout', quantity: 60, revision: inv.revision } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.inventory.containers.loadout.items[0].quantity, 60);

  const stale = await call('POST', '/v1/inventory/sell', { token, body: { itemId: ammo.id, quantity: 1, revision: inv.revision } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'INVENTORY_CONFLICT');

  res = await call('POST', '/v1/inventory/sell', { token, body: { itemId: ammo.id, quantity: 10 } });
  assert.equal(res.body.result.credits, 20);

  // dedicated server: verify token, start match, loadout locked, end match with loot
  assert.equal((await call('POST', '/v1/server/sessions/verify', { body: { token } })).status, 401);
  const verified = await call('POST', '/v1/server/sessions/verify', { serverKey: SERVER_KEY, body: { token } });
  assert.equal(verified.body.account.id, accountId);

  await call('POST', `/v1/server/players/${accountId}/match/start`, { serverKey: SERVER_KEY, body: { matchId: 'it-1' } });
  inv = (await call('GET', '/v1/inventory', { token })).body;
  const loaded = inv.containers.loadout.items[0];
  const locked = await call('POST', '/v1/inventory/move', { token, body: { itemId: loaded.id, container: 'stash' } });
  assert.equal(locked.body.error.code, 'LOADOUT_LOCKED');

  const end = await call('POST', `/v1/server/players/${accountId}/match/end`, {
    serverKey: SERVER_KEY,
    body: { matchId: 'it-1', consume: [{ itemId: loaded.id, quantity: 45 }], grants: [{ itemCode: 'scrap_metal', quantity: 30 }], credits: 100 },
  });
  assert.equal(end.status, 200, JSON.stringify(end.body));
  assert.equal(end.body.inventory.containers.loadout.items[0].quantity, 15);
  assert.equal(end.body.inventory.inMatch, false);

  // sessions + logout
  const sessions = (await call('GET', '/v1/me/sessions', { token })).body.sessions;
  assert.equal(sessions.filter((s) => s.current).length, 1);
  assert.equal((await call('POST', '/v1/auth/logout', { token })).status, 204);
  assert.equal((await call('GET', '/v1/me', { token })).status, 401);
});
