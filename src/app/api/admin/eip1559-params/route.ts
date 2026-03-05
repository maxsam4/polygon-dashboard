import { NextResponse } from 'next/server';
import { getAllEip1559Params, insertEip1559Param } from '@/lib/queries/eip1559Params';
import { getSessionFromCookies } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getSessionFromCookies();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const params = await getAllEip1559Params();
    return NextResponse.json({
      params: params.map(p => ({
        id: p.id,
        blockNumber: p.blockNumber.toString(),
        baseFeeChangeDenominator: p.baseFeeChangeDenominator,
        description: p.description,
        createdAt: p.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('EIP-1559 params GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch params' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSessionFromCookies();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { blockNumber, baseFeeChangeDenominator, description } = body;

    if (blockNumber === undefined || blockNumber === null ||
        baseFeeChangeDenominator === undefined || baseFeeChangeDenominator === null) {
      return NextResponse.json(
        { error: 'blockNumber and baseFeeChangeDenominator are required' },
        { status: 400 }
      );
    }

    // Validate blockNumber is a valid non-negative integer string
    const blockStr = String(blockNumber);
    if (!/^\d+$/.test(blockStr)) {
      return NextResponse.json(
        { error: 'blockNumber must be a non-negative integer' },
        { status: 400 }
      );
    }

    // Validate baseFeeChangeDenominator is a strict positive integer within int32 range
    const bfcdStr = String(baseFeeChangeDenominator);
    if (!/^\d+$/.test(bfcdStr)) {
      return NextResponse.json(
        { error: 'baseFeeChangeDenominator must be a positive integer' },
        { status: 400 }
      );
    }
    const bfcd = Number(bfcdStr);
    if (!Number.isSafeInteger(bfcd) || bfcd < 1 || bfcd > 2147483647) {
      return NextResponse.json(
        { error: 'baseFeeChangeDenominator must be between 1 and 2147483647' },
        { status: 400 }
      );
    }

    const blockNum = BigInt(blockStr);

    const inserted = await insertEip1559Param({
      blockNumber: blockNum,
      baseFeeChangeDenominator: bfcd,
      description: description || undefined,
    });

    if (!inserted) {
      return NextResponse.json(
        { error: 'A parameter already exists for this block number', duplicate: true },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('EIP-1559 params POST error:', error);
    return NextResponse.json({ error: 'Failed to add param' }, { status: 500 });
  }
}
