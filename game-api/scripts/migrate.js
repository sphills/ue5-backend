// Usage: npm run migrate   (reads DB_* settings from the environment or .env)
import { config } from '../src/config.js';
import { createDb } from '../src/db/pool.js';
import { migrate } from '../src/db/migrations.js';

const db = createDb(config.db);
try {
  await migrate(db);
} catch (err) {
  console.error('migration failed:', err.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
