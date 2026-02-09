'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

const POLL_INTERVAL_MS = 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_HISTORY = 300;
const POLYGON_CHAIN_ID = 137;

export interface EndpointStatus {
  url: string;
  type: 'polygon-http';
  blockNumber: bigint | null;
  latencyMs: number | null;
  lastError: string | null;
  consecutiveErrors: number;
  chainIdVerified: boolean;
  chainIdMismatch: boolean;
}

export interface BlockHistoryPoint {
  time: number; // performance.now() relative, converted to unix seconds for chart
  block: number;
  latencyMs: number;
}

interface EndpointState {
  status: EndpointStatus;
  history: BlockHistoryPoint[];
}

async function probeEndpoint(
  url: string,
  method: string,
  params: unknown[],
  signal: AbortSignal,
): Promise<{ result: string; latencyMs: number }> {
  const start = performance.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal,
  });
  const latencyMs = Math.round(performance.now() - start);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'RPC error');
  return { result: json.result, latencyMs };
}

export function useRpcPolling(urls: string[]) {
  const stateRef = useRef<Map<string, EndpointState>>(new Map());
  const chainIdChecked = useRef<Set<string>>(new Set());
  const [renderTick, setRenderTick] = useState(0);
  const urlsRef = useRef<string[]>(urls);
  urlsRef.current = urls;

  // Initialize state for new URLs
  useEffect(() => {
    for (const url of urls) {
      if (!stateRef.current.has(url)) {
        stateRef.current.set(url, {
          status: {
            url,
            type: 'polygon-http',
            blockNumber: null,
            latencyMs: null,
            lastError: null,
            consecutiveErrors: 0,
            chainIdVerified: false,
            chainIdMismatch: false,
          },
          history: [],
        });
      }
    }
  }, [urls]);

  const pollAll = useCallback(async () => {
    const currentUrls = urlsRef.current;
    if (currentUrls.length === 0) return;

    const now = Math.floor(Date.now() / 1000);

    await Promise.allSettled(
      currentUrls.map(async (url) => {
        const state = stateRef.current.get(url);
        if (!state) return;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        try {
          // Check chain ID on first success
          if (!chainIdChecked.current.has(url)) {
            const { result: chainIdHex } = await probeEndpoint(
              url, 'eth_chainId', [], controller.signal,
            );
            chainIdChecked.current.add(url);
            const chainId = parseInt(chainIdHex, 16);
            if (chainId !== POLYGON_CHAIN_ID) {
              state.status.chainIdMismatch = true;
              state.status.lastError = `Wrong chain: ${chainId}`;
            }
          }

          const { result: blockHex, latencyMs } = await probeEndpoint(
            url, 'eth_blockNumber', [], controller.signal,
          );

          const blockNumber = BigInt(blockHex);
          state.status.blockNumber = blockNumber;
          state.status.latencyMs = latencyMs;
          state.status.lastError = null;
          state.status.consecutiveErrors = 0;
          if (!state.status.chainIdMismatch) {
            state.status.chainIdVerified = true;
          }

          // Add to history
          state.history.push({
            time: now,
            block: Number(blockNumber),
            latencyMs,
          });
          if (state.history.length > MAX_HISTORY) {
            state.history = state.history.slice(-MAX_HISTORY);
          }
        } catch (err) {
          const message = err instanceof DOMException && err.name === 'AbortError'
            ? 'Timeout'
            : err instanceof TypeError && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError'))
              ? 'CORS'
              : err instanceof Error ? err.message : 'Unknown error';
          state.status.lastError = message;
          state.status.consecutiveErrors++;
          state.status.latencyMs = null;
        } finally {
          clearTimeout(timeout);
        }
      }),
    );

    setRenderTick((t) => t + 1);
  }, []);

  // Polling with visibility pause
  useEffect(() => {
    if (urls.length === 0) return;

    let interval: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      pollAll();
      interval = setInterval(pollAll, POLL_INTERVAL_MS);
    };

    const stop = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        start();
      } else {
        stop();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    start();

    return () => {
      stop();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [urls.length, pollAll]);

  // Compute derived values
  const endpoints: EndpointStatus[] = [];
  const history = new Map<string, BlockHistoryPoint[]>();
  let highestBlock: bigint | null = null;

  for (const url of urls) {
    const state = stateRef.current.get(url);
    if (state) {
      endpoints.push(state.status);
      history.set(url, state.history);
      if (state.status.blockNumber !== null) {
        if (highestBlock === null || state.status.blockNumber > highestBlock) {
          highestBlock = state.status.blockNumber;
        }
      }
    }
  }

  // Force re-read on renderTick
  void renderTick;

  return { endpoints, highestBlock, history };
}
