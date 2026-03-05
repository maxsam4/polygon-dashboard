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

    if (!blockNumber || !baseFeeChangeDenominator) {
      return NextResponse.json(
        { error: 'blockNumber and baseFeeChangeDenominator are required' },
        { status: 400 }
      );
    }

    // Validate blockNumber is a valid integer string
    if (!/^\d+$/.test(String(blockNumber))) {
      return NextResponse.json(
        { error: 'blockNumber must be a non-negative integer' },
        { status: 400 }
      );
    }

    // Validate baseFeeChangeDenominator is a strict positive integer
    const bfcdStr = String(baseFeeChangeDenominator);
    if (!/^\d+$/.test(bfcdStr) || Number(bfcdStr) <= 0) {
      return NextResponse.json(
        { error: 'baseFeeChangeDenominator must be a positive integer' },
        { status: 400 }
      );
    }

    const blockNum = BigInt(blockNumber);
    const bfcd = Number(bfcdStr);

    // Check for duplicate
    const existing = await getAllEip1559Params();
    const isDuplicate = existing.some(p => p.blockNumber === blockNum);
    if (isDuplicate) {
      return NextResponse.json(
        { error: 'A parameter already exists for this block number', duplicate: true },
        { status: 409 }
      );
    }

    await insertEip1559Param({
      blockNumber: blockNum,
      baseFeeChangeDenominator: bfcd,
      description: description || undefined,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('EIP-1559 params POST error:', error);
    return NextResponse.json({ error: 'Failed to add param' }, { status: 500 });
  }
}
