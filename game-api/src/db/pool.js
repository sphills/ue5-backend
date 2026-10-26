// Thin wrapper over a mysql2 pool. No ORM: repositories write their own SQL and call
//   db.query(sql, params)                 -> rows (SELECT) or a result header (INSERT/UPDATE/DELETE)
//   db.transaction(async (tx) => { ... })  -> tx.query(...) runs on one connection; commits on
//                                            success, rolls back on throw, retries deadlocks.
// mysql2's `query` (client-side escaping) is used rather than `execute` so `IN (?)` and bulk
// `VALUES ?` work with arrays. Values are always passed as parameters, never concatenated.
import mysql from 'mysql2/promise';

const RETRYABLE = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);

export function createDb(cfg, { logger } = {}) {
  const pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    connectionLimit: cfg.connectionLimit,
    waitForConnections: true,
    charset: 'utf8mb4',
    timezone: 'Z', // DATETIME values are UTC
    supportBigNumbers: true,
    decimalNumbers: true,
    enableKeepAlive: true,
  });

  // Every connection works in UTC so NOW() matches the 'Z' timezone above.
  pool.pool.on('connection', (conn) => {
    conn.query("SET time_zone = '+00:00'");
  });

  async function query(sql, params) {
    const [result] = await pool.query(sql, params);
    return result;
  }

  async function transaction(fn, { retries = 3 } = {}) {
    for (let attempt = 1; ; attempt++) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const tx = {
          query: async (sql, params) => (await conn.query(sql, params))[0],
        };
        const result = await fn(tx);
        await conn.commit();
        return result;
      } catch (err) {
        await conn.rollback().catch(() => {});
        if (RETRYABLE.has(err.code) && attempt < retries) {
          logger?.warn({ code: err.code, attempt }, 'retrying transaction');
          continue;
        }
        throw err;
      } finally {
        conn.release();
      }
    }
  }

  return {
    query,
    transaction,
    ping: () => query('SELECT 1 AS ok'),
    close: () => pool.end(),
  };
}
