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

// Auto-generate session secret on server startup using Web Crypto API (Edge-compatible)
// Sessions will be invalidated on server restart, which is acceptable for admin
let generatedSecret: string | null = null;

function getGeneratedSecret(): string {
  if (!generatedSecret) {
    // Use Web Crypto API for Edge Runtime compatibility
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    generatedSecret = Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
    console.log('[Auth] Generated new session secret (sessions will expire on restart)');
  }
  return generatedSecret;
}

function getSecretKey(): Uint8Array {
  return new TextEncoder().encode(getGeneratedSecret());
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
    .sign(getSecretKey());

  return token;
}

/**
 * Verify a session token and return the payload if valid.
 */
export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
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
