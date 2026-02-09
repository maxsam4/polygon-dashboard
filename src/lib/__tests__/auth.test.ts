// Tests for auth.ts - authentication functions
// Mock jose before importing auth module
jest.mock('jose', () => ({
  SignJWT: jest.fn().mockImplementation(() => ({
    setProtectedHeader: jest.fn().mockReturnThis(),
    setIssuedAt: jest.fn().mockReturnThis(),
    setExpirationTime: jest.fn().mockReturnThis(),
    sign: jest.fn().mockResolvedValue('mock.jwt.token'),
  })),
  jwtVerify: jest.fn().mockImplementation(async (token: string) => {
    if (token === 'mock.jwt.token' || token === 'valid-token') {
      return { payload: { admin: true, iat: 1234567890, exp: 1234657890 } };
    }
    throw new Error('Invalid token');
  }),
}));

// Mock next/headers
jest.mock('next/headers', () => ({
  cookies: jest.fn().mockReturnValue({
    get: jest.fn(),
  }),
}));

import { verifyPassword, createSession, verifySession, isAuthConfigured } from '../auth';

// Store original env values
const originalEnv = { ...process.env };

beforeEach(() => {
  // Reset env for each test
  process.env.ADMIN_PASSWORD = 'test-admin-password';

});

afterEach(() => {
  // Restore original env
  process.env = { ...originalEnv };
});

describe('verifyPassword', () => {
  it('returns true for correct password', () => {
    expect(verifyPassword('test-admin-password')).toBe(true);
  });

  it('returns false for incorrect password', () => {
    expect(verifyPassword('wrong-password')).toBe(false);
  });

  it('returns false for empty password', () => {
    expect(verifyPassword('')).toBe(false);
  });

  it('uses ADD_RATE_PASSWORD as fallback', () => {
    delete process.env.ADMIN_PASSWORD;
    process.env.ADD_RATE_PASSWORD = 'fallback-password';
    expect(verifyPassword('fallback-password')).toBe(true);
    expect(verifyPassword('wrong')).toBe(false);
  });

  it('returns false when no password is configured', () => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ADD_RATE_PASSWORD;
    expect(verifyPassword('any-password')).toBe(false);
  });
});

describe('createSession and verifySession', () => {
  it('creates a valid JWT token', async () => {
    const token = await createSession();
    expect(typeof token).toBe('string');
    expect(token).toBe('mock.jwt.token');
  });

  it('verifySession returns payload for valid token', async () => {
    const payload = await verifySession('valid-token');

    expect(payload).not.toBeNull();
    expect(payload?.admin).toBe(true);
    expect(typeof payload?.iat).toBe('number');
    expect(typeof payload?.exp).toBe('number');
  });

  it('verifySession returns null for invalid token', async () => {
    const payload = await verifySession('invalid-token');
    expect(payload).toBeNull();
  });
});

describe('isAuthConfigured', () => {
  it('returns true when password is set', () => {
    expect(isAuthConfigured()).toBe(true);
  });

  it('returns false when password is missing', () => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ADD_RATE_PASSWORD;
    expect(isAuthConfigured()).toBe(false);
  });

  it('returns true when using ADD_RATE_PASSWORD fallback', () => {
    delete process.env.ADMIN_PASSWORD;
    process.env.ADD_RATE_PASSWORD = 'fallback';
    expect(isAuthConfigured()).toBe(true);
  });


});
