import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check if this is a protected route
  const isAdminRoute = pathname.startsWith('/admin');
  const isAlertsRoute = pathname === '/alerts';

  if (!isAdminRoute && !isAlertsRoute) {
    return NextResponse.next();
  }

  // Allow access to login page without authentication
  if (pathname === '/admin/login') {
    // If already authenticated, redirect to admin dashboard
    const session = await getSessionFromRequest(request);
    if (session) {
      return NextResponse.redirect(new URL('/admin', request.url));
    }
    return NextResponse.next();
  }

  // Check authentication for /admin/* and /alerts routes
  const session = await getSessionFromRequest(request);
  if (!session) {
    // Redirect to login page
    const loginUrl = new URL('/admin/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/alerts'],
};
