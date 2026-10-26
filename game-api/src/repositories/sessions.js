// SQL for the sessions table. Tokens are never stored, only their SHA-256.

export async function create(q, { accountId, tokenHash, clientType, ip, userAgent, ttlSeconds }) {
  const res = await q.query(
    `INSERT INTO sessions (account_id, token_hash, client_type, ip, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, NOW(3) + INTERVAL ? SECOND)`,
    [accountId, tokenHash, clientType, ip ?? null, userAgent ? userAgent.slice(0, 255) : null, ttlSeconds],
  );
  return Number(res.insertId);
}

export async function findActiveByTokenHash(q, tokenHash) {
  const rows = await q.query(
    `SELECT s.id, s.account_id, s.client_type, s.expires_at,
            TIMESTAMPDIFF(SECOND, s.last_seen_at, NOW(3)) AS idle_seconds,
            a.username, a.status
       FROM sessions s
       JOIN accounts a ON a.id = s.account_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > NOW(3)`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

export async function touch(q, id) {
  await q.query('UPDATE sessions SET last_seen_at = NOW(3) WHERE id = ?', [id]);
}

export async function listActive(q, accountId) {
  return q.query(
    `SELECT id, client_type, ip, user_agent, created_at, last_seen_at, expires_at
       FROM sessions
      WHERE account_id = ? AND revoked_at IS NULL AND expires_at > NOW(3)
      ORDER BY last_seen_at DESC`,
    [accountId],
  );
}

export async function revoke(q, accountId, sessionId) {
  const res = await q.query(
    'UPDATE sessions SET revoked_at = NOW(3) WHERE id = ? AND account_id = ? AND revoked_at IS NULL',
    [sessionId, accountId],
  );
  return res.affectedRows > 0;
}

/** Revoke every active session of the account except `exceptId`, optionally of one client type. */
export async function revokeOthers(q, accountId, { exceptId = 0, clientType = null } = {}) {
  const res = await q.query(
    `UPDATE sessions SET revoked_at = NOW(3)
      WHERE account_id = ? AND id <> ? AND revoked_at IS NULL AND expires_at > NOW(3)
        AND (? IS NULL OR client_type = ?)`,
    [accountId, exceptId, clientType, clientType],
  );
  return res.affectedRows;
}

/** Keep at most `keep` active sessions of a client type, revoking the least recently used. */
export async function trimActive(q, accountId, clientType, keep) {
  const rows = await q.query(
    `SELECT id FROM sessions
      WHERE account_id = ? AND client_type = ? AND revoked_at IS NULL AND expires_at > NOW(3)
      ORDER BY last_seen_at DESC, id DESC`,
    [accountId, clientType],
  );
  const extra = rows.slice(keep).map((r) => r.id);
  if (extra.length === 0) return 0;
  const res = await q.query('UPDATE sessions SET revoked_at = NOW(3) WHERE account_id = ? AND id IN (?)', [accountId, extra]);
  return res.affectedRows;
}

/** Housekeeping: drop sessions that expired or were revoked more than a week ago. */
export async function purgeOld(q) {
  const res = await q.query(
    `DELETE FROM sessions
      WHERE expires_at < NOW(3) - INTERVAL 7 DAY
         OR (revoked_at IS NOT NULL AND revoked_at < NOW(3) - INTERVAL 7 DAY)`,
  );
  return res.affectedRows;
}
