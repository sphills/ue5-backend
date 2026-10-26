// SQL for the accounts table. `q` is the db or a transaction handle.

const ACCOUNT_COLUMNS = `id, username, email, status, credits, stash_slots, inventory_revision,
  active_match_id, match_started_at, last_match_id, created_at`;

// in_match is computed in SQL so a crashed server's lock lapses without a cleanup job.
const IN_MATCH = `(active_match_id IS NOT NULL AND match_started_at > NOW(3) - INTERVAL ? SECOND) AS in_match`;

export async function create(q, { username, email, passwordHash, credits, stashSlots }) {
  const res = await q.query(
    `INSERT INTO accounts (username, username_key, email, password_hash, credits, stash_slots)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [username, username.toLowerCase(), email ?? null, passwordHash, credits, stashSlots],
  );
  return Number(res.insertId);
}

export async function findForLogin(q, username) {
  const rows = await q.query(
    'SELECT id, username, status, password_hash FROM accounts WHERE username_key = ?',
    [username.toLowerCase()],
  );
  return rows[0] ?? null;
}

export async function findById(q, id, maxMatchSeconds) {
  const rows = await q.query(`SELECT ${ACCOUNT_COLUMNS}, ${IN_MATCH} FROM accounts WHERE id = ?`, [maxMatchSeconds, id]);
  return rows[0] ?? null;
}

/** Lock the account row for the rest of the transaction. All inventory writes go through this. */
export async function lockById(q, id, maxMatchSeconds) {
  const rows = await q.query(`SELECT ${ACCOUNT_COLUMNS}, ${IN_MATCH} FROM accounts WHERE id = ? FOR UPDATE`, [maxMatchSeconds, id]);
  return rows[0] ?? null;
}

export async function getPasswordHash(q, id) {
  const rows = await q.query('SELECT password_hash FROM accounts WHERE id = ?', [id]);
  return rows[0]?.password_hash ?? null;
}

export async function setPasswordHash(q, id, passwordHash) {
  await q.query('UPDATE accounts SET password_hash = ? WHERE id = ?', [passwordHash, id]);
}

/** Apply a credit change and bump the inventory revision. */
export async function applyInventoryChange(q, id, creditsDelta) {
  await q.query(
    'UPDATE accounts SET credits = credits + ?, inventory_revision = inventory_revision + 1 WHERE id = ?',
    [creditsDelta, id],
  );
}

export async function startMatch(q, id, matchId) {
  await q.query('UPDATE accounts SET active_match_id = ?, match_started_at = NOW(3) WHERE id = ?', [matchId, id]);
}

export async function endMatch(q, id, matchId) {
  await q.query(
    'UPDATE accounts SET active_match_id = NULL, match_started_at = NULL, last_match_id = ? WHERE id = ?',
    [matchId, id],
  );
}

export function isDuplicateKey(err, keyName) {
  return err?.code === 'ER_DUP_ENTRY' && (!keyName || String(err.message).includes(keyName));
}
