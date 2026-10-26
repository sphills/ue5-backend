// Renders every page and submits the main forms against a stub Game API (no database needed).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { sign } from '../src/cookies.js';

let createApp;
try {
  ({ createApp } = await import('../src/app.js'));
} catch (err) {
  if (err.code !== 'ERR_MODULE_NOT_FOUND') throw err;
}
const skip = !createApp && 'run npm install first';

const item = (id, slot, code, name, category, quantity, extra = {}) => ({
  id,
  slot,
  quantity,
  acquiredAt: '2026-10-25T10:00:00.000Z',
  item: { code, name, description: `${name}.`, category, rarity: 'common', maxStack: quantity > 1 ? 120 : 1, sellPrice: 2, sellable: true, discardable: true, loadoutAllowed: true, assetPath: null, ...extra },
});

const state = { revision: 3, inMatch: false, calls: [] };
const inventory = () => ({
  accountId: 1,
  revision: state.revision,
  credits: 1250,
  inMatch: state.inMatch,
  containers: {
    stash: { capacity: 12, used: 2, locked: false, items: [item(10, 0, 'ammo_556', '5.56 Rounds', 'ammo', 90), item(11, 3, 'keycard_lab', 'Lab Keycard', 'quest', 1, { sellable: false, discardable: false })] },
    loadout: { capacity: 4, used: 1, locked: state.inMatch, items: [item(12, 0, 'rifle_service', 'Service Rifle', 'weapon', 1)] },
  },
});

let api;
let web;
let webBase;

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

before(async () => {
  if (skip) return;
  api = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      state.calls.push({ method: req.method, url: req.url, body, auth: req.headers.authorization });
      const authed = req.headers.authorization === 'Bearer good-token';
      if (req.url === '/v1/auth/login') {
        return body.password === 'right-password'
          ? json(res, 200, { token: 'good-token', account: { id: 1 } })
          : json(res, 401, { error: { code: 'INVALID_CREDENTIALS', message: 'Wrong username or password' } });
      }
      if (!authed) return json(res, 401, { error: { code: 'SESSION_INVALID', message: 'Session expired' } });
      switch (`${req.method} ${req.url.split('?')[0]}`) {
        case 'GET /v1/inventory':
          return json(res, 200, inventory());
        case 'POST /v1/inventory/move':
          if (body.revision !== state.revision) return json(res, 409, { error: { code: 'INVENTORY_CONFLICT', message: 'changed', details: { revision: state.revision } } });
          state.revision++;
          return json(res, 200, { result: { moved: 90 }, inventory: inventory() });
        case 'GET /v1/me':
          return json(res, 200, { account: { id: 1, username: 'Ada', email: null, credits: 1250, stashSlots: 12, inMatch: false, createdAt: '2026-01-02T00:00:00.000Z' } });
        case 'GET /v1/me/sessions':
          return json(res, 200, { sessions: [{ id: 5, clientType: 'web', ip: '127.0.0.1', userAgent: 'test', lastSeenAt: new Date().toISOString(), current: true }, { id: 6, clientType: 'game', ip: null, userAgent: null, lastSeenAt: new Date().toISOString(), current: false }] });
        case 'GET /v1/me/history':
          return json(res, 200, { events: [{ id: 1, action: 'sell', itemName: '5.56 Rounds', quantity: 10, creditsDelta: 20, actor: 'player', reason: null, at: new Date().toISOString() }] });
        case 'POST /v1/auth/logout':
          return json(res, 204);
        default:
          return json(res, 404, { error: { code: 'NOT_FOUND', message: 'nope' } });
      }
    });
  });
  await new Promise((r) => api.listen(0, '127.0.0.1', r));

  const app = createApp({
    config: {
      trustProxy: 'loopback',
      gameApiUrl: `http://127.0.0.1:${api.address().port}`,
      apiTimeoutMs: 2000,
      cookieSecret: 'test-secret',
      secureCookies: false,
      siteName: 'Stash',
      isProduction: false,
    },
    logger: { error() {} },
  });
  await new Promise((r) => {
    web = app.listen(0, '127.0.0.1', r);
  });
  webBase = `http://127.0.0.1:${web.address().port}`;
});

after(async () => {
  if (skip) return;
  await new Promise((r) => web.close(r));
  await new Promise((r) => api.close(r));
});

// Tiny browser: keeps cookies, does not follow redirects.
function browser() {
  const jar = new Map();
  async function go(method, path, form) {
    const headers = { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') };
    let body;
    if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
    }
    const res = await fetch(webBase + path, { method, headers, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (/Expires=Thu, 01 Jan 1970/i.test(c) || value === '') jar.delete(name);
      else jar.set(name, value);
    }
    return { status: res.status, location: res.headers.get('location'), html: await res.text() };
  }
  const csrfOf = (html) => /name="_csrf" value="([^"]+)"/.exec(html)?.[1];
  return { go, csrfOf, jar };
}

test('signed-out visitors are sent to the login page', { skip }, async () => {
  const b = browser();
  assert.equal((await b.go('GET', '/stash')).location, '/login?next=%2Fstash');
  const login = await b.go('GET', '/login');
  assert.equal(login.status, 200);
  assert.match(login.html, /<form[^>]+action="\/login"/);
  const reg = await b.go('GET', '/register');
  assert.match(reg.html, /Create account/);
  assert.equal((await b.go('GET', '/nowhere')).status, 404);
});

test('forms without the CSRF token are rejected', { skip }, async () => {
  const b = browser();
  await b.go('GET', '/login');
  const res = await b.go('POST', '/login', { username: 'Ada', password: 'right-password' });
  assert.equal(res.status, 403);
});

test('login, browse, move, conflict, account, logout', { skip }, async () => {
  const b = browser();
  let page = await b.go('GET', '/login');
  const bad = await b.go('POST', '/login', { _csrf: b.csrfOf(page.html), username: 'Ada', password: 'wrong', next: '/stash' });
  assert.equal(bad.status, 400);
  assert.match(bad.html, /Wrong username or password/);

  const ok = await b.go('POST', '/login', { _csrf: b.csrfOf(page.html), username: 'Ada', password: 'right-password', next: '/stash?view=loadout' });
  assert.equal(ok.status, 302);
  assert.equal(ok.location, '/stash?view=loadout');

  page = await b.go('GET', '/stash');
  assert.equal(page.status, 200);
  assert.match(page.html, /1,250/);
  assert.match(page.html, /href="\/items\/10"/);
  assert.match(page.html, /5\.56 Rounds/);
  assert.equal((page.html.match(/class="empty"/g) ?? []).length, 10);

  page = await b.go('GET', '/stash?view=loadout');
  assert.match(page.html, /Service Rifle/);

  page = await b.go('GET', '/items/10');
  assert.equal(page.status, 200);
  assert.match(page.html, /Send to Loadout/);
  assert.match(page.html, /Split stack/);
  assert.match(page.html, /Throw away/);
  assert.match(page.html, /name="revision" value="3"/);

  const quest = await b.go('GET', '/items/11');
  assert.doesNotMatch(quest.html, /Throw away/);
  assert.doesNotMatch(quest.html, /Sell for/);

  const moved = await b.go('POST', '/items/10/move', { _csrf: b.csrfOf(page.html), revision: '3', from: 'stash', container: 'loadout', slot: '2', quantity: '90' });
  assert.equal(moved.status, 302);
  const sent = state.calls.findLast((c) => c.url === '/v1/inventory/move');
  assert.deepEqual(sent.body, { itemId: 10, revision: 3, container: 'loadout', slot: 2, quantity: 90 });
  page = await b.go('GET', moved.location);
  assert.match(page.html, /Moved 90 to Loadout, slot 3/);

  // stale revision: flash message, back to the item
  const stale = await b.go('POST', '/items/10/move', { _csrf: b.csrfOf(page.html), revision: '3', from: 'stash', container: 'loadout' });
  assert.equal(stale.location, '/items/10');
  page = await b.go('GET', '/items/10');
  assert.match(page.html, /changed while this page was open/);

  page = await b.go('GET', '/account');
  assert.equal(page.status, 200);
  assert.match(page.html, /Game client/);
  assert.match(page.html, /This device/);
  assert.match(page.html, /Sold/);

  const out = await b.go('POST', '/logout', { _csrf: b.csrfOf(page.html) });
  assert.equal(out.location, '/login');
  assert.equal((await b.go('GET', '/stash')).status, 302);
});

test('match lock is shown and loadout actions are hidden', { skip }, async () => {
  state.inMatch = true;
  try {
    const b = browser();
    const page = await b.go('GET', '/login');
    await b.go('POST', '/login', { _csrf: b.csrfOf(page.html), username: 'Ada', password: 'right-password' });
    const loadout = await b.go('GET', '/stash?view=loadout');
    assert.match(loadout.html, /locked while you&#39;re in a match|locked while you're in a match/);
    const rifle = await b.go('GET', '/items/12');
    assert.doesNotMatch(rifle.html, /Throw away/);
  } finally {
    state.inMatch = false;
  }
});

test('an expired API session signs the browser out', { skip }, async () => {
  const b = browser();
  b.jar.set('sid', sign('revoked-token', 'test-secret')); // validly signed, but the API rejects it
  const res = await b.go('GET', '/stash');
  assert.equal(res.location, '/login?next=%2Fstash');
  assert.equal(b.jar.has('sid'), false, 'session cookie cleared');
});
