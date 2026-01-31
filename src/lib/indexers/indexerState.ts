import { query, queryOne } from '../db';

// Cursor state for indexers
export interface IndexerCursor {
  blockNumber: bigint;
  hash: string;
}

interface IndexerStateRow {
  service_name: string;
  last_block: string;
  last_hash: string;
  updated_at: Date;
}

/**
 * Get the current cursor state for an indexer service.
 * Returns null if the service hasn't been initialized yet.
 */
export async function getIndexerState(serviceName: string): Promise<IndexerCursor | null> {
  const row = await queryOne<IndexerStateRow>(
    `SELECT * FROM indexer_state WHERE service_name = $1`,
    [serviceName]
  );

  if (!row) return null;

  return {
    blockNumber: BigInt(row.last_block),
    hash: row.last_hash,
  };
}

/**
 * Initialize the cursor state for a new indexer service.
 * Fails if the service already exists (use updateIndexerState for updates).
 */
export async function initializeIndexerState(
  serviceName: string,
  blockNumber: bigint,
  hash: string
): Promise<void> {
  await query(
    `INSERT INTO indexer_state (service_name, last_block, last_hash, updated_at)
     VALUES ($1, $2, $3, NOW())`,
    [serviceName, blockNumber.toString(), hash]
  );
}

/**
 * Update the cursor state for an indexer service.
 * Creates the row if it doesn't exist.
 */
export async function updateIndexerState(
  serviceName: string,
  blockNumber: bigint,
  hash: string
): Promise<void> {
  await query(
    `INSERT INTO indexer_state (service_name, last_block, last_hash, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (service_name) DO UPDATE SET
       last_block = EXCLUDED.last_block,
       last_hash = EXCLUDED.last_hash,
       updated_at = NOW()`,
    [serviceName, blockNumber.toString(), hash]
  );
}

/**
 * Delete the cursor state for an indexer service.
 * Used for testing or resetting an indexer.
 */
export async function deleteIndexerState(serviceName: string): Promise<void> {
  await query(
    `DELETE FROM indexer_state WHERE service_name = $1`,
    [serviceName]
  );
}

/**
 * Get all indexer states.
 */
export async function getAllIndexerStates(): Promise<Array<{
  serviceName: string;
  blockNumber: bigint;
  hash: string;
  updatedAt: Date;
}>> {
  const rows = await query<IndexerStateRow>(
    `SELECT * FROM indexer_state ORDER BY service_name`
  );

  return rows.map(row => ({
    serviceName: row.service_name,
    blockNumber: BigInt(row.last_block),
    hash: row.last_hash,
    updatedAt: row.updated_at,
  }));
}
