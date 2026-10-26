import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { sign, unsign, parseCookies } from '../src/cookies.js';
import { GameApi, ApiError } from '../src/apiClient.js';
import { safeNext } from '../src/middleware/session.js';
import { grid, findItem, timeAgo, deviceLabel, otherContainer } from '../src/view.js';

describe('signed cookies', () => {
  test('round trip and tamper detection', () => {
    const s = sign('token.with.dots', 'secret');
    assert.equal(unsign(s, 'secret'), 'token.with.dots');
    assert.equal(unsign(s, 'other-secret'), null);
    assert.equal(unsign(s.slice(0, -1) + (s.at(-1) === 'A' ? 'B' : 'A'), 'secret'), null);
    assert.equal(unsign('no-signature', 'secret'), null);
    assert.equal(unsign(undefined, 'secret'), null);
  });

  test('parses a Cookie header', () => {
    assert.deepEqual(parseCookies('a=1; b=hello%20world; c="q"; a=dup'), { a: '1', b: 'hello world', c: 'q' });
    assert.deepEqual(parseCookies(undefined), {});
  });
});

describe('safeNext', () => {
  test('only allows local paths', () => {
    assert.equal(safeNext('/items/5'), '/items/5');
    assert.equal(safeNext('//evil.example'), '/stash');
    assert.equal(safeNext('/\\evil.example'), '/stash');
    assert.equal(safeNext('https://evil.example'), '/stash');
    assert.equal(safeNext(undefined), '/stash');
  });
});

describe('view helpers', () => {
  const inventory = {
    containers: {
      stash: { capacity: 4, items: [{ id: 7, slot: 2, quantity: 1, item: { name: 'Rifle' } }] },
      loadout: { capacity: 2, items: [{ id: 9, slot: 0, quantity: 5, item: { name: 'Medkit' } }] },
    },
  };

  test('grid places items by slot', () => {
    assert.deepEqual(grid(inventory.containers.stash).map((c) => c?.id ?? null), [null, null, 7, null]);
  });

  test('findItem reports the container', () => {
    assert.equal(findItem(inventory, 9).container, 'loadout');
    assert.equal(findItem(inventory, 1), null);
    assert.equal(otherContainer('stash'), 'loadout');
  });

  test('timeAgo and device labels', () => {
    const now = Date.parse('2026-10-25T12:00:00Z');
    assert.equal(timeAgo('2026-10-25T11:59:30Z', now), 'just now');
    assert.equal(timeAgo('2026-10-25T11:45:00Z', now), '15 min ago');
    assert.equal(timeAgo('2026-10-23T12:00:00Z', now), '2 days ago');
    assert.equal(deviceLabel({ clientType: 'game' }), 'Game client');
    assert.equal(
      deviceLabel({ clientType: 'web', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' }),
      'Web Safari on iOS',
    );
  });
});

describe('GameApi client', () => {
  let server;
  let baseUrl;
  const seen = [];

  before(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : undefined });
        res.setHeader('content-type', 'application/json');
        if (req.url === '/v1/auth/login') {
          res.end(JSON.stringify({ token: 'tok', account: { id: 1 } }));
        } else if (req.url === '/v1/inventory/sell') {
          res.statusCode = 409;
          res.end(JSON.stringify({ error: { code: 'INVENTORY_CONFLICT', message: 'changed', details: { revision: 4 } } }));
        } else if (req.url === '/v1/auth/logout') {
          res.statusCode = 204;
          res.end();
        } else if (req.url === '/broken') {
          res.end('<html>');
        } else {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'nope' } }));
        }
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => new Promise((r) => server.close(r)));

  test('sends the web client type, bearer token and forwarded IP', async () => {
    const api = new GameApi({ baseUrl, clientIp: '203.0.113.9', userAgent: 'UA' });
    const out = await api.login('ada', 'pw');
    assert.equal(out.token, 'tok');
    const req = seen.at(-1);
    assert.deepEqual(req.body, { username: 'ada', password: 'pw', client: 'web' });
    assert.equal(req.headers['x-forwarded-for'], '203.0.113.9');
    assert.match(req.headers['user-agent'], /UA \(via WebClient\)/);

    const authed = new GameApi({ baseUrl, token: 'abc' });
    assert.equal(await authed.logout(), null);
    assert.equal(seen.at(-1).headers.authorization, 'Bearer abc');
  });

  test('turns API errors into ApiError with code and details', async () => {
    const api = new GameApi({ baseUrl, token: 'abc' });
    await assert.rejects(api.sell({ itemId: 1 }), (err) => err instanceof ApiError && err.status === 409 && err.code === 'INVENTORY_CONFLICT' && err.details.revision === 4);
    await assert.rejects(api.request('GET', '/broken'), (err) => err.code === 'BAD_API_RESPONSE');
  });

  test('unreachable API becomes a 503', async () => {
    const api = new GameApi({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 2000 });
    await assert.rejects(api.inventory(), (err) => err.status === 503 && err.code === 'API_UNAVAILABLE');
  });
});
