// Minimal forward-only migration runner. Files in /migrations named NNN_description.sql run
// once each, in order, and are recorded in schema_migrations. Plain SQL, no ORM.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

/** Split a SQL file into statements: strips full-line `--` comments, splits on `;` at end of line. */
export function splitSql(text) {
  const lines = text.split(/\r?\n/).filter((line) => !/^\s*--/.test(line));
  const statements = [];
  let current = [];
  for (const line of lines) {
    current.push(line);
    if (/;\s*$/.test(line)) {
      const stmt = current.join('\n').trim().replace(/;\s*$/, '');
      if (stmt) statements.push(stmt);
      current = [];
    }
  }
  const tail = current.join('\n').trim();
  if (tail) statements.push(tail);
  return statements;
}

export async function listMigrationFiles(dir = MIGRATIONS_DIR) {
  return (await readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
}

export async function migrate(db, { dir = MIGRATIONS_DIR, log = console.log } = {}) {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(255) NOT NULL PRIMARY KEY,
    applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  const applied = new Set((await db.query('SELECT version FROM schema_migrations')).map((r) => r.version));
  const files = await listMigrationFiles(dir);
  const ran = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    log(`applying ${file}`);
    const statements = splitSql(await readFile(path.join(dir, file), 'utf8'));
    // MySQL commits DDL implicitly, so a failed migration can leave partial changes;
    // keep each file small and fix forward.
    for (const stmt of statements) await db.query(stmt);
    await db.query('INSERT INTO schema_migrations (version) VALUES (?)', [file]);
    ran.push(file);
  }
  if (ran.length === 0) log('database is up to date');
  return ran;
}
