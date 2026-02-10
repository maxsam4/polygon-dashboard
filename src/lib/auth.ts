import { SignJWT, jwtVerify, JWTPayload } from 'jose';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

const SESSION_COOKIE_NAME = 'admin_session';
const SESSION_DURATION_HOURS = 24;

interface SessionPayload extends JWTPayload {
  admin: boolean;
  iat: number;
  exp: number;
}

// Derive session signing key deterministically from admin password via SHA-256.
// This ensures Edge Runtime (middleware) and Node.js Runtime (API routes)
// produce the same key since both read the same env var.
// SHA-256 is one-way: the admin password cannot be recovered from the key.
async function getSecretKey(): Promise<Uint8Array> {
  const adminPassword = process.env.ADMIN_PASSWORD || process.env.ADD_RATE_PASSWORD || '';
  const data = new TextEncoder().encode(`polygon-dashboard-session:${adminPassword}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hash);
}

/**
 * Verify the admin password against the environment variable.
 */
export function verifyPassword(password: string): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD || process.env.ADD_RATE_PASSWORD;
  if (!adminPassword) {
    console.warn('[Auth] No admin password configured - authentication disabled');
    return false;
  }
  return password === adminPassword;
}

/**
 * Create a new session JWT token.
 */
export async function createSession(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + SESSION_DURATION_HOURS * 60 * 60;

  const token = await new SignJWT({ admin: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .sign(await getSecretKey());

  return token;
}

/**
 * Verify a session token and return the payload if valid.
 */
export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, await getSecretKey());
    if (payload.admin === true) {
      return payload as SessionPayload;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get session from cookies (for use in API routes).
 * Call this with await cookies() in server components.
 */
export async function getSessionFromCookies(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);
  if (!sessionCookie?.value) {
    return null;
  }
  return verifySession(sessionCookie.value);
}

/**
 * Get session from request (for use in middleware).
 */
export async function getSessionFromRequest(request: NextRequest): Promise<SessionPayload | null> {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME);
  if (!sessionCookie?.value) {
    return null;
  }
  return verifySession(sessionCookie.value);
}

/**
 * Set the session cookie with the token.
 * Returns the Set-Cookie header value.
 */
export function getSessionCookieHeader(token: string): string {
  const maxAge = SESSION_DURATION_HOURS * 60 * 60;
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
}

/**
 * Get the header to clear the session cookie.
 */
export function getClearSessionCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

/**
 * Check if authentication is configured.
 * Only requires a password - session secret is auto-generated.
 */
export function isAuthConfigured(): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD || process.env.ADD_RATE_PASSWORD;
  return !!adminPassword;
}
