const inflight = new Map<string, Promise<unknown>>();
const cache = new Map<string, { data: unknown; expiry: number }>();

const CACHE_TTL_MS = 5000;

/**
 * Fetch with in-flight deduplication and short TTL cache.
 * Concurrent identical requests share one promise; slightly offset
 * mounts (within 5s) reuse the cached result.
 */
export async function cachedFetch<T = unknown>(url: string): Promise<T> {
  const now = Date.now();
  const cached = cache.get(url);
  if (cached && cached.expiry > now) {
    return cached.data as T;
  }

  const existing = inflight.get(url);
  if (existing) {
    return existing as Promise<T>;
  }

  const promise = fetch(url)
    .then(async (res) => {
      const data = await res.json();
      cache.set(url, { data, expiry: Date.now() + CACHE_TTL_MS });
      return data;
    })
    .finally(() => {
      inflight.delete(url);
    });

  inflight.set(url, promise);
  return promise as Promise<T>;
}
