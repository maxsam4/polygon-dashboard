import { NextResponse } from 'next/server';
import { getClearSessionCookieHeader } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST() {
  const cookieHeader = getClearSessionCookieHeader();
  const response = NextResponse.json({ success: true });
  response.headers.set('Set-Cookie', cookieHeader);
  return response;
}
