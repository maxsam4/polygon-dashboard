// Global test configuration and setup

// Mock environment variables for tests
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test_db';
process.env.POLYGON_RPC_URLS = 'https://rpc1.test.com,https://rpc2.test.com';
process.env.HEIMDALL_API_URLS = 'https://heimdall1.test.com,https://heimdall2.test.com';

// Reset mocks between tests
beforeEach(() => {
  jest.clearAllMocks();
});

// Cleanup after all tests
afterAll(async () => {
  // Give time for any pending async operations
  await new Promise(resolve => setTimeout(resolve, 100));
});

// Global test utilities
export const TEST_CONSTANTS = {
  SAMPLE_BLOCK_NUMBER: 50000000n,
  SAMPLE_TIMESTAMP: new Date('2024-01-15T12:00:00Z'),
  SAMPLE_BLOCK_HASH: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as `0x${string}`,
  SAMPLE_PARENT_HASH: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as `0x${string}`,
  SAMPLE_GAS_USED: 15000000n,
  SAMPLE_GAS_LIMIT: 30000000n,
  SAMPLE_BASE_FEE_WEI: 30000000000n, // 30 gwei
};

// Helper to wait for async operations
export function flushPromises(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}
