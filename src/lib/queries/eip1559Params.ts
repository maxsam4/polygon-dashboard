import { query, queryOne } from '../db';

export interface Eip1559ParamRow {
  id: number;
  block_number: string;
  base_fee_change_denominator: number;
  description: string | null;
  created_at: string;
}

export interface Eip1559ParamRecord {
  id: number;
  blockNumber: bigint;
  baseFeeChangeDenominator: number;
  description: string | null;
  createdAt: Date;
}

function rowToRecord(row: Eip1559ParamRow): Eip1559ParamRecord {
  return {
    id: row.id,
    blockNumber: BigInt(row.block_number),
    baseFeeChangeDenominator: row.base_fee_change_denominator,
    description: row.description,
    createdAt: new Date(row.created_at),
  };
}

export async function getAllEip1559Params(): Promise<Eip1559ParamRecord[]> {
  const rows = await query<Eip1559ParamRow>(
    `SELECT * FROM eip1559_params ORDER BY block_number ASC`
  );
  return rows.map(rowToRecord);
}

export async function insertEip1559Param(param: {
  blockNumber: bigint;
  baseFeeChangeDenominator: number;
  description?: string;
}): Promise<boolean> {
  const rows = await query<{ id: number }>(
    `INSERT INTO eip1559_params (block_number, base_fee_change_denominator, description)
     VALUES ($1, $2, $3)
     ON CONFLICT (block_number) DO NOTHING
     RETURNING id`,
    [param.blockNumber.toString(), param.baseFeeChangeDenominator, param.description ?? null]
  );
  return rows.length > 0;
}

export async function getEip1559ParamCount(): Promise<number> {
  const result = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM eip1559_params`
  );
  return parseInt(result?.count ?? '0', 10);
}
