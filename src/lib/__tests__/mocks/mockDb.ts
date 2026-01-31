// Mock database utilities for testing

type QueryCall = {
  sql: string;
  params?: unknown[];
};

// Track all query calls for assertions
let queryCalls: QueryCall[] = [];

// Configurable return values by SQL pattern
const queryResponses = new Map<RegExp, unknown>();

export function resetMockDb(): void {
  queryCalls = [];
  queryResponses.clear();
}

export function getQueryCalls(): QueryCall[] {
  return [...queryCalls];
}

export function setQueryResponse(pattern: RegExp, response: unknown): void {
  queryResponses.set(pattern, response);
}

function findResponse(sql: string): unknown {
  for (const [pattern, response] of queryResponses) {
    if (pattern.test(sql)) {
      return typeof response === 'function' ? response() : response;
    }
  }
  return [];
}

// Mock query function
export const mockQuery = jest.fn(async <T>(sql: string, params?: unknown[]): Promise<T[]> => {
  queryCalls.push({ sql, params });
  const response = findResponse(sql);
  return response as T[];
});

// Mock queryOne function
export const mockQueryOne = jest.fn(async <T>(sql: string, params?: unknown[]): Promise<T | null> => {
  queryCalls.push({ sql, params });
  const response = findResponse(sql);
  if (Array.isArray(response)) {
    return (response[0] as T) ?? null;
  }
  return response as T | null;
});

// Mock pool for transaction support
export const mockPoolClient = {
  query: jest.fn(),
  release: jest.fn(),
};

export const mockPool = {
  query: jest.fn(),
  connect: jest.fn(() => Promise.resolve(mockPoolClient)),
  end: jest.fn(),
  on: jest.fn(),
};

export const mockGetPool = jest.fn(() => mockPool);

// Mock withTransaction function
export const mockWithTransaction = jest.fn(async <T>(fn: (client: typeof mockPoolClient) => Promise<T>): Promise<T> => {
  mockPoolClient.query.mockResolvedValueOnce({}); // BEGIN
  try {
    const result = await fn(mockPoolClient);
    mockPoolClient.query.mockResolvedValueOnce({}); // COMMIT
    return result;
  } catch (e) {
    mockPoolClient.query.mockResolvedValueOnce({}); // ROLLBACK
    throw e;
  }
});

// Apply mocks to the db module
export function applyDbMocks(): void {
  jest.mock('@/lib/db', () => ({
    query: mockQuery,
    queryOne: mockQueryOne,
    getPool: mockGetPool,
    withTransaction: mockWithTransaction,
    closePool: jest.fn(),
  }));
}
