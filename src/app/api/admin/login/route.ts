import { NextResponse } from 'next/server';
import { verifyPassword, createSession, getSessionCookieHeader, isAuthConfigured } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    if (!isAuthConfigured()) {
      return NextResponse.json(
        { error: 'Authentication not configured. Set ADMIN_PASSWORD and ADMIN_SESSION_SECRET.' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { password } = body;

    if (!password) {
      return NextResponse.json(
        { error: 'Password is required' },
        { status: 400 }
      );
    }

    if (!verifyPassword(password)) {
      return NextResponse.json(
        { error: 'Invalid password' },
        { status: 401 }
      );
    }

    // Create session token
    const token = await createSession();
    const cookieHeader = getSessionCookieHeader(token);

    // Return success with Set-Cookie header
    const response = NextResponse.json({ success: true });
    response.headers.set('Set-Cookie', cookieHeader);
    return response;
  } catch (error) {
    console.error('[Admin Login] Error:', error);
    return NextResponse.json(
      { error: 'Login failed' },
      { status: 500 }
    );
  }
}
