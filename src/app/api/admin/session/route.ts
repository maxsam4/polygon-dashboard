import { NextResponse } from 'next/server';
import { getSessionFromCookies, isAuthConfigured } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // If auth is not configured, return not authenticated
    if (!isAuthConfigured()) {
      return NextResponse.json({ authenticated: false });
    }

    const session = await getSessionFromCookies();
    return NextResponse.json({ authenticated: session !== null });
  } catch {
    return NextResponse.json({ authenticated: false });
  }
}
