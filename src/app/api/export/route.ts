import { NextRequest, NextResponse } from 'next/server';
import { getBlocksPaginated } from '@/lib/queries';

const ALL_FIELDS = [
  'block_number',
  'timestamp',
  'gas_used',
  'gas_limit',
  'gas_used_percent',
  'base_fee_gwei',
  'avg_priority_fee_gwei',
  'min_priority_fee_gwei',
  'max_priority_fee_gwei',
  'total_base_fee_gwei',
  'total_priority_fee_gwei',
  'tx_count',
  'block_time_sec',
  'mgas_per_sec',
  'tps',
  'finalized',
  'time_to_finality_sec',
] as const;

type ExportField = (typeof ALL_FIELDS)[number];

interface ExportRequest {
  fromBlock: string;
  toBlock: string;
  fields: ExportField[];
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ExportRequest;
    const { fromBlock, toBlock, fields } = body;

    if (!fromBlock || !toBlock) {
      return NextResponse.json(
        { error: 'fromBlock and toBlock are required' },
        { status: 400 }
      );
    }

    const validFields = fields.filter((f) => ALL_FIELDS.includes(f));
    if (validFields.length === 0) {
      return NextResponse.json(
        { error: 'At least one valid field is required' },
        { status: 400 }
      );
    }

    // Fetch all blocks in range (paginated internally)
    const allBlocks: Record<string, unknown>[] = [];
    let page = 1;
    const limit = 1000;

    while (true) {
      const { blocks } = await getBlocksPaginated(
        page,
        limit,
        BigInt(fromBlock),
        BigInt(toBlock)
      );

      if (blocks.length === 0) break;

      for (const block of blocks) {
        const row: Record<string, unknown> = {};
        for (const field of validFields) {
          switch (field) {
            case 'block_number':
              row[field] = block.blockNumber.toString();
              break;
            case 'timestamp':
              row[field] = block.timestamp.toISOString();
              break;
            case 'gas_used':
              row[field] = block.gasUsed.toString();
              break;
            case 'gas_limit':
              row[field] = block.gasLimit.toString();
              break;
            case 'gas_used_percent':
              row[field] = Number(block.gasUsed * 100n / block.gasLimit);
              break;
            case 'base_fee_gwei':
              row[field] = block.baseFeeGwei;
              break;
            case 'avg_priority_fee_gwei':
              row[field] = block.avgPriorityFeeGwei;
              break;
            case 'min_priority_fee_gwei':
              row[field] = block.minPriorityFeeGwei;
              break;
            case 'max_priority_fee_gwei':
              row[field] = block.maxPriorityFeeGwei;
              break;
            case 'total_base_fee_gwei':
              row[field] = block.totalBaseFeeGwei;
              break;
            case 'total_priority_fee_gwei':
              row[field] = block.totalPriorityFeeGwei;
              break;
            case 'tx_count':
              row[field] = block.txCount;
              break;
            case 'block_time_sec':
              row[field] = block.blockTimeSec;
              break;
            case 'mgas_per_sec':
              row[field] = block.mgasPerSec;
              break;
            case 'tps':
              row[field] = block.tps;
              break;
            case 'finalized':
              row[field] = block.finalized;
              break;
            case 'time_to_finality_sec':
              row[field] = block.timeToFinalitySec;
              break;
          }
        }
        allBlocks.push(row);
      }

      if (blocks.length < limit) break;
      page++;
    }

    // Generate CSV
    const header = validFields.join(',');
    const rows = allBlocks.map((row) =>
      validFields.map((f) => row[f] ?? '').join(',')
    );
    const csv = [header, ...rows].join('\n');

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="blocks_${fromBlock}_${toBlock}.csv"`,
      },
    });
  } catch (error) {
    console.error('Error exporting blocks:', error);
    return NextResponse.json(
      { error: 'Failed to export blocks' },
      { status: 500 }
    );
  }
}
