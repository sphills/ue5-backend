import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parse, fields, v } from '../src/validate.js';
import { hashPassword, verifyPassword, hashToken, newSessionToken, matchesAnyKey } from '../src/security.js';
import { splitSql } from '../src/db/migrations.js';
import { createRateLimiter } from '../src/middleware/rateLimit.js';
import { createCatalogCache } from '../src/game/catalog.js';

describe('validation', () => {
  test('accepts and trims good input, coerces numeric strings', () => {
    const out = parse({ username: fields.username, slot: v.int({ min: 0 }) }, { username: '  Ada_99 ', slot: '0' });
    assert.deepEqual(out, { username: 'Ada_99', slot: 0 });
  });

  test('reports every bad field at once', () => {
    assert.throws(
      () => parse({ username: fields.username, password: fields.password, client: fields.clientType }, { username: 'a!', client: 'phone' }),
      (err) =>
        err.status === 400 &&
        err.code === 'VALIDATION_ERROR' &&
        Object.keys(err.details.fields).sort().join() === 'client,password,username',
    );
  });

  test('optional fields may be absent', () => {
    assert.deepEqual(parse({ quantity: v.int({ min: 1 }).optional() }, {}), {});
  });

  test('arrays validate each entry', () => {
    const schema = { items: v.array({ itemCode: v.string({ min: 1 }), quantity: v.int({ min: 1 }) }) };
    assert.deepEqual(parse(schema, { items: [{ itemCode: 'ammo', quantity: 3 }] }), { items: [{ itemCode: 'ammo', quantity: 3 }] });
    assert.throws(() => parse(schema, { items: [{ itemCode: 'ammo', quantity: 0 }] }), /entry 0: quantity/);
  });

  test('rejects fractional and non-numeric integers', () => {
    assert.throws(() => parse({ n: v.int() }, { n: 1.5 }), /must be an integer/);
    assert.throws(() => parse({ n: v.int() }, { n: '12abc' }), /must be an integer/);
  });
});

describe('security', () => {
  test('password hashes verify and differ per call', async () => {
    const fast = { N: 1024, r: 8, p: 1, keylen: 32, maxmem: 32 * 1024 * 1024 };
    const h1 = await hashPassword('correct horse', fast);
    const h2 = await hashPassword('correct horse', fast);
    assert.notEqual(h1, h2);
    assert.equal(await verifyPassword('correct horse', h1), true);
    assert.equal(await verifyPassword('wrong horse', h1), false);
    assert.equal(await verifyPassword('x', 'garbage'), false);
  });

  test('tokens are random and hashed to 32 bytes', () => {
    const t = newSessionToken();
    assert.notEqual(t, newSessionToken());
    assert.equal(hashToken(t).length, 32);
  });

  test('server key check', () => {
    assert.equal(matchesAnyKey('k2', ['k1', 'k2']), true);
    assert.equal(matchesAnyKey('k3', ['k1', 'k2']), false);
    assert.equal(matchesAnyKey(undefined, ['k1']), false);
    assert.equal(matchesAnyKey('k1', []), false);
  });
});

describe('migrations', () => {
  test('splitSql ignores comments and keeps quoted semicolon-free content intact', () => {
    const sql = `-- header\nCREATE TABLE a (\n  id INT -- trailing\n);\n\nINSERT INTO a VALUES (1), ('it''s');\n-- end`;
    assert.deepEqual(splitSql(sql), ['CREATE TABLE a (\n  id INT -- trailing\n)', "INSERT INTO a VALUES (1), ('it''s')"]);
  });
});

describe('rate limiter', () => {
  test('allows `limit` hits per window then blocks until reset', () => {
    let t = 0;
    const rl = createRateLimiter({ windowMs: 1000, limit: 2, keyFn: () => 'k', now: () => t });
    assert.equal(rl.hit('k').allowed, true);
    assert.equal(rl.hit('k').allowed, true);
    assert.equal(rl.hit('k').allowed, false);
    assert.equal(rl.hit('other').allowed, true);
    t = 1001;
    assert.equal(rl.hit('k').allowed, true);
    rl.stop();
  });
});

describe('catalog cache', () => {
  test('loads once, then serves from memory within the TTL', async () => {
    let loads = 0;
    const cache = createCatalogCache(async () => {
      loads++;
      return [{ id: 1, code: 'ammo', name: 'Ammo', description: '', category: 'ammo', rarity: 'common', max_stack: 100, sell_price: 1, is_sellable: 1, is_discardable: 1, loadout_allowed: 1, asset_path: null }];
    }, 60_000);
    const [a, b] = await Promise.all([cache.get(), cache.get()]);
    assert.equal(a, b);
    assert.equal(loads, 1);
    assert.equal(a.byCode('ammo').maxStack, 100);
    assert.equal(a.byId('1').code, 'ammo');
  });
});
