// src/lib/waitForMigrations.ts
import { getPool } from './db';

// Essential tables that must exist before workers can start
const REQUIRED_TABLES = [
  'blocks',
  'milestones',
  'block_finality',
  'indexer_state',
];

const MAX_RETRIES = 30;
const INITIAL_DELAY_MS = 1000;
const MAX_DELAY_MS = 10000;

async function checkTablesExist(): Promise<{ ready: boolean; missing: string[] }> {
  const pool = getPool();

  const result = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public'
     AND tablename = ANY($1)`,
    [REQUIRED_TABLES]
  );

  const existingTables = new Set(result.rows.map(r => r.tablename));
  const missing = REQUIRED_TABLES.filter(t => !existingTables.has(t));

  return {
    ready: missing.length === 0,
    missing,
  };
}

export async function waitForMigrations(): Promise<void> {
  console.log('[Migrations] Waiting for database migrations to complete...');
  console.log(`[Migrations] Required tables: ${REQUIRED_TABLES.join(', ')}`);

  let attempt = 0;
  let delay = INITIAL_DELAY_MS;

  while (attempt < MAX_RETRIES) {
    attempt++;

    try {
      const { ready, missing } = await checkTablesExist();

      if (ready) {
        console.log('[Migrations] All required tables exist. Migrations ready.');
        return;
      }

      console.log(
        `[Migrations] Attempt ${attempt}/${MAX_RETRIES}: Missing tables: ${missing.join(', ')}. ` +
        `Retrying in ${delay}ms...`
      );
    } catch (error) {
      console.log(
        `[Migrations] Attempt ${attempt}/${MAX_RETRIES}: Database not ready. ` +
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}. ` +
        `Retrying in ${delay}ms...`
      );
    }

    await new Promise(resolve => setTimeout(resolve, delay));

    // Exponential backoff with cap
    delay = Math.min(delay * 1.5, MAX_DELAY_MS);
  }

  throw new Error(
    `[Migrations] Timeout waiting for migrations after ${MAX_RETRIES} attempts. ` +
    `Required tables: ${REQUIRED_TABLES.join(', ')}`
  );
}
