// Endpoints for UE5 dedicated servers only (X-Server-Key). Never ship the key in a client build.
import { Router } from 'express';
import { parse, fields, v } from '../validate.js';
import { RULES } from '../game/rules.js';
import { unauthorized } from '../errors.js';

const matchId = v.string({ min: 1, max: 64, pattern: /^[A-Za-z0-9._:-]+$/, message: 'must be 1-64 characters: letters, digits, . _ : -' });
const itemEntry = { itemCode: v.string({ min: 1, max: 64 }), quantity: v.int({ min: 1, max: RULES.maxGrantQuantity }) };
const consumeEntry = { itemId: fields.id, quantity: v.int({ min: 1, max: RULES.maxGrantQuantity }).optional() };
const credits = v.int({ min: 0, max: RULES.maxCreditGrant });

export function serverRoutes({ auth, inventory, matches }) {
  const r = Router();

  // A player connecting to a dedicated server passes their session token (e.g. in the
  // PreLogin options string). The server checks it here before accepting the connection.
  r.post('/sessions/verify', async (req, res) => {
    const { token } = parse({ token: v.string({ min: 10, max: 128 }) }, req.body);
    const session = await auth.authenticate(token);
    if (!session) throw unauthorized('SESSION_INVALID', 'Session expired or signed out');
    const account = await auth.getProfile(session.accountId);
    res.json({ session, account });
  });

  const player = (req) => parse({ accountId: fields.id }, req.params).accountId;

  r.get('/players/:accountId', async (req, res) => {
    res.json({ account: await auth.getProfile(player(req)) });
  });

  r.get('/players/:accountId/inventory', async (req, res) => {
    res.json(await inventory.getInventory(player(req)));
  });

  r.post('/players/:accountId/match/start', async (req, res) => {
    const input = parse({ matchId }, req.body);
    res.json(await matches.startMatch(player(req), input.matchId));
  });

  // { matchId, consume?: [{ itemId, quantity? }], grants?: [{ itemCode, quantity }], credits? }
  r.post('/players/:accountId/match/end', async (req, res) => {
    const input = parse(
      {
        matchId,
        consume: v.array(consumeEntry, { max: 200 }).optional(),
        grants: v.array(itemEntry, { max: 200 }).optional(),
        credits: credits.optional(),
      },
      req.body,
    );
    res.json(await matches.endMatch(player(req), input));
  });

  // { items: [{ itemCode, quantity }], credits?, reason, container? }
  r.post('/players/:accountId/grants', async (req, res) => {
    const input = parse(
      {
        items: v.array(itemEntry, { max: 200 }).optional(),
        credits: credits.optional(),
        reason: v.string({ min: 1, max: 128 }),
        container: v.oneOf(RULES.containers).optional(),
      },
      req.body,
    );
    res.json(await matches.grant(player(req), input));
  });

  return r;
}
