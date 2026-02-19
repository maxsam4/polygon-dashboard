import { sanitizeEndpoint, recordRpcCall, flushBuffer, getBufferLength, clearBuffer } from '../rpcStats';
import { RpcTimeoutError } from '../rpc';
import type { RpcStatRecord } from '../rpc';

// Mock the db module
jest.mock('../db', () => ({
  query: jest.fn().mockResolvedValue([]),
}));

import { query } from '../db';
const mockQuery = query as jest.MockedFunction<typeof query>;

describe('sanitizeEndpoint', () => {
  it('extracts hostname from full URL', () => {
    expect(sanitizeEndpoint('https://polygon-rpc.com/v1/abc123')).toBe('polygon-rpc.com');
  });

  it('extracts hostname from URL with port', () => {
    expect(sanitizeEndpoint('http://localhost:8545')).toBe('localhost');
  });

  it('returns original string for invalid URL', () => {
    expect(sanitizeEndpoint('not-a-url')).toBe('not-a-url');
  });

  it('extracts hostname stripping API keys from path', () => {
    expect(sanitizeEndpoint('https://rpc.ankr.com/polygon/abc123secret')).toBe('rpc.ankr.com');
  });
});

describe('RpcTimeoutError', () => {
  it('has correct name and message', () => {
    const error = new RpcTimeoutError(2000);
    expect(error.name).toBe('RpcTimeoutError');
    expect(error.message).toBe('RPC call timed out after 2000ms');
    expect(error.timeoutMs).toBe(2000);
  });

  it('is instanceof Error', () => {
    expect(new RpcTimeoutError(1000)).toBeInstanceOf(Error);
  });
});

describe('buffer behavior', () => {
  beforeEach(() => {
    clearBuffer();
    mockQuery.mockClear();
  });

  function makeStat(overrides?: Partial<RpcStatRecord>): RpcStatRecord {
    return {
      timestamp: new Date('2026-02-19T00:00:00Z'),
      endpoint: 'rpc.test.com',
      method: 'eth_blockNumber',
      success: true,
      isTimeout: false,
      responseTimeMs: 150,
      ...overrides,
    };
  }

  it('records calls to the buffer', () => {
    expect(getBufferLength()).toBe(0);
    recordRpcCall(makeStat());
    expect(getBufferLength()).toBe(1);
    recordRpcCall(makeStat());
    expect(getBufferLength()).toBe(2);
  });

  it('flushBuffer inserts all records and clears buffer', async () => {
    recordRpcCall(makeStat({ endpoint: 'a.test' }));
    recordRpcCall(makeStat({ endpoint: 'b.test' }));
    expect(getBufferLength()).toBe(2);

    await flushBuffer();

    expect(getBufferLength()).toBe(0);
    expect(mockQuery).toHaveBeenCalledTimes(1);

    // Verify the SQL has two value rows
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('INSERT INTO rpc_call_stats');
    // 2 rows = 14 params ($1 through $14)
    expect(sql).toContain('$14');

    // Verify param values
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params).toHaveLength(14);
    expect(params[1]).toBe('a.test');
    expect(params[8]).toBe('b.test');
  });

  it('flushBuffer is no-op when buffer is empty', async () => {
    await flushBuffer();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('flushBuffer handles DB errors gracefully', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));
    recordRpcCall(makeStat());

    // Should not throw
    await expect(flushBuffer()).resolves.toBeUndefined();
    expect(getBufferLength()).toBe(0); // buffer was swapped before error
  });

  it('records error_message as null when not provided', async () => {
    recordRpcCall(makeStat({ errorMessage: undefined }));
    await flushBuffer();

    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[6]).toBeNull(); // error_message
  });

  it('records error_message when provided', async () => {
    recordRpcCall(makeStat({ success: false, errorMessage: 'timeout' }));
    await flushBuffer();

    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[6]).toBe('timeout');
  });
});
