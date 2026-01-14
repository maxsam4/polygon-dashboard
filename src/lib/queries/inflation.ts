import { query, queryOne } from '../db';
import { InflationRate, InflationRateRow } from '../types';

function rowToInflationRate(row: InflationRateRow): InflationRate {
  return {
    id: row.id,
    blockNumber: BigInt(row.block_number),
    blockTimestamp: new Date(row.block_timestamp),
    interestPerYearLog2: BigInt(row.interest_per_year_log2),
    startSupply: BigInt(row.start_supply),
    startTimestamp: BigInt(row.start_timestamp),
    implementationAddress: row.implementation_address,
    createdAt: new Date(row.created_at),
  };
}

/**
 * Get all inflation rates ordered by block timestamp
 */
export async function getAllInflationRates(): Promise<InflationRate[]> {
  const rows = await query<InflationRateRow>(
    `SELECT * FROM inflation_rates ORDER BY block_timestamp ASC`
  );
  return rows.map(rowToInflationRate);
}

/**
 * Get the latest (most recent) inflation rate
 */
export async function getLatestInflationRate(): Promise<InflationRate | null> {
  const row = await queryOne<InflationRateRow>(
    `SELECT * FROM inflation_rates ORDER BY block_timestamp DESC LIMIT 1`
  );
  return row ? rowToInflationRate(row) : null;
}

/**
 * Insert a new inflation rate
 */
export async function insertInflationRate(rate: {
  blockNumber: bigint;
  blockTimestamp: Date;
  interestPerYearLog2: bigint;
  startSupply: bigint;
  startTimestamp: bigint;
  implementationAddress: string;
}): Promise<void> {
  await query(
    `INSERT INTO inflation_rates
      (block_number, block_timestamp, interest_per_year_log2, start_supply, start_timestamp, implementation_address)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (block_number) DO NOTHING`,
    [
      rate.blockNumber.toString(),
      rate.blockTimestamp.toISOString(),
      rate.interestPerYearLog2.toString(),
      rate.startSupply.toString(),
      rate.startTimestamp.toString(),
      rate.implementationAddress,
    ]
  );
}

/**
 * Check if inflation_rates table has any data
 */
export async function hasInflationRates(): Promise<boolean> {
  const result = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM inflation_rates) as exists`
  );
  return result?.exists ?? false;
}

/**
 * Get count of inflation rates
 */
export async function getInflationRateCount(): Promise<number> {
  const result = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM inflation_rates`
  );
  return parseInt(result?.count ?? '0', 10);
}
