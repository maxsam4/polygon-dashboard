import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getSessionFromCookies();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const polygonHttp = process.env.POLYGON_RPC_URLS?.split(',').map(s => s.trim()).filter(Boolean) || [];
    const polygonWs = process.env.POLYGON_WS_URLS?.split(',').map(s => s.trim()).filter(Boolean) || [];

    return NextResponse.json({ polygonHttp, polygonWs });
  } catch (error) {
    console.error('[Admin RPC URLs] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch RPC URLs' },
      { status: 500 }
    );
  }
}
