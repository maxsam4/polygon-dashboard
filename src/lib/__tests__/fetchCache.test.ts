import { cachedFetch } from '../fetchCache';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
  // Clear module-level maps by re-importing would be complex,
  // so we use unique URLs per test to avoid cross-test cache hits
});

function jsonResponse(data: unknown) {
  return Promise.resolve({
    json: () => Promise.resolve(data),
  });
}

describe('cachedFetch', () => {
  it('fetches and returns parsed JSON', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ data: [1, 2, 3] }));

    const result = await cachedFetch('/api/test-basic');
    expect(result).toEqual({ data: [1, 2, 3] });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith('/api/test-basic');
  });

  it('deduplicates concurrent identical requests', async () => {
    let resolveJson: (v: unknown) => void;
    const jsonPromise = new Promise((resolve) => { resolveJson = resolve; });

    mockFetch.mockReturnValueOnce(
      Promise.resolve({ json: () => jsonPromise })
    );

    const url = '/api/test-dedup-' + Date.now();
    const p1 = cachedFetch(url);
    const p2 = cachedFetch(url);

    // Only one fetch call should have been made
    expect(mockFetch).toHaveBeenCalledTimes(1);

    resolveJson!({ value: 42 });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual({ value: 42 });
    expect(r2).toEqual({ value: 42 });
  });

  it('serves from TTL cache on subsequent calls', async () => {
    const url = '/api/test-cache-' + Date.now();
    mockFetch.mockReturnValueOnce(jsonResponse({ cached: true }));

    const r1 = await cachedFetch(url);
    const r2 = await cachedFetch(url);

    expect(r1).toEqual({ cached: true });
    expect(r2).toEqual({ cached: true });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('refetches after cache expires', async () => {
    jest.useFakeTimers();
    const url = '/api/test-expire-' + Math.random();

    mockFetch.mockReturnValueOnce(jsonResponse({ v: 1 }));
    const r1 = await cachedFetch(url);
    expect(r1).toEqual({ v: 1 });

    // Advance past the 5s TTL
    jest.advanceTimersByTime(6000);

    mockFetch.mockReturnValueOnce(jsonResponse({ v: 2 }));
    const r2 = await cachedFetch(url);
    expect(r2).toEqual({ v: 2 });
    expect(mockFetch).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });

  it('does not cache across different URLs', async () => {
    const base = '/api/test-diff-' + Date.now();
    mockFetch
      .mockReturnValueOnce(jsonResponse({ url: 'a' }))
      .mockReturnValueOnce(jsonResponse({ url: 'b' }));

    const r1 = await cachedFetch(base + '-a');
    const r2 = await cachedFetch(base + '-b');

    expect(r1).toEqual({ url: 'a' });
    expect(r2).toEqual({ url: 'b' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
