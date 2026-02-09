'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

const MAX_RACE_HISTORY = 100;
const RACE_GRACE_MS = 500;
const RACE_TIMEOUT_MS = 10_000;
const PENALTY_DELTA_MS = 10_000;
const RECONNECT_INITIAL_MS = 2000;
const RECONNECT_MAX_MS = 30000;

export interface WsEndpointStatus {
  url: string;
  connected: boolean;
  lastBlock: bigint | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  lastError: string | null;
}

export interface WsDeltaPoint {
  time: number; // unix seconds
  deltaMs: number;
}

interface RaceEntry {
  firstArrival: number; // performance.now()
  arrivals: Map<string, number>; // url -> performance.now()
  recordedDeltas: Set<string>; // urls already recorded — prevents double-counting
  settled: boolean; // true after Phase 1 (500ms)
  finalized: boolean; // true after Phase 2 (10s)
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function recordDelta(url: string, deltaMs: number, nowSec: number, stateRef: Map<string, { status: WsEndpointStatus; deltas: number[]; history: WsDeltaPoint[] }>) {
  const state = stateRef.get(url);
  if (!state) return;

  state.deltas.push(deltaMs);
  if (state.deltas.length > MAX_RACE_HISTORY) {
    state.deltas = state.deltas.slice(-MAX_RACE_HISTORY);
  }
  state.history.push({ time: nowSec, deltaMs });
  if (state.history.length > MAX_RACE_HISTORY) {
    state.history = state.history.slice(-MAX_RACE_HISTORY);
  }

  const sorted = [...state.deltas].sort((a, b) => a - b);
  state.status.p25 = percentile(sorted, 25);
  state.status.p50 = percentile(sorted, 50);
  state.status.p75 = percentile(sorted, 75);
}

export function useWsBlockRace(urls: string[]) {
  const wsRefs = useRef<Map<string, WebSocket>>(new Map());
  const stateRef = useRef<Map<string, { status: WsEndpointStatus; deltas: number[]; history: WsDeltaPoint[] }>>(new Map());
  const racesRef = useRef<Map<string, RaceEntry>>(new Map()); // blockNumber hex -> race
  const reconnectDelays = useRef<Map<string, number>>(new Map());
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
            connected: false,
            lastBlock: null,
            p25: null,
            p50: null,
            p75: null,
            lastError: null,
          },
          deltas: [],
          history: [],
        });
      }
    }
  }, [urls]);

  const settleRace = useCallback((blockHex: string) => {
    const race = racesRef.current.get(blockHex);
    if (!race || race.settled) return;
    race.settled = true;

    const nowSec = Math.floor(Date.now() / 1000);

    for (const [url, arrivalTime] of race.arrivals) {
      if (race.recordedDeltas.has(url)) continue;
      race.recordedDeltas.add(url);
      const deltaMs = Math.round(arrivalTime - race.firstArrival);
      recordDelta(url, deltaMs, nowSec, stateRef.current);
    }

    setRenderTick((t) => t + 1);
  }, []);

  const finalizeRace = useCallback((blockHex: string) => {
    const race = racesRef.current.get(blockHex);
    if (!race || race.finalized) return;

    // Settle first if not already done
    if (!race.settled) {
      race.settled = true;
    }
    race.finalized = true;

    const nowSec = Math.floor(Date.now() / 1000);

    // Record deltas for late arrivals (between 500ms and 10s)
    for (const [url, arrivalTime] of race.arrivals) {
      if (race.recordedDeltas.has(url)) continue;
      race.recordedDeltas.add(url);
      const deltaMs = Math.round(arrivalTime - race.firstArrival);
      recordDelta(url, deltaMs, nowSec, stateRef.current);
    }

    // Penalize connected endpoints that never delivered this block
    for (const url of urlsRef.current) {
      if (race.recordedDeltas.has(url)) continue;
      const state = stateRef.current.get(url);
      if (!state || !state.status.connected) continue;
      race.recordedDeltas.add(url);
      recordDelta(url, PENALTY_DELTA_MS, nowSec, stateRef.current);
    }

    setRenderTick((t) => t + 1);
  }, []);

  const handleNewBlock = useCallback((url: string, blockHex: string) => {
    const state = stateRef.current.get(url);
    if (state) {
      state.status.lastBlock = BigInt(blockHex);
    }

    const now = performance.now();
    let race = racesRef.current.get(blockHex);
    if (!race) {
      race = { firstArrival: now, arrivals: new Map(), recordedDeltas: new Set(), settled: false, finalized: false };
      racesRef.current.set(blockHex, race);
      // Clean up old races (keep last 20)
      if (racesRef.current.size > 20) {
        const keys = [...racesRef.current.keys()];
        for (let i = 0; i < keys.length - 20; i++) {
          racesRef.current.delete(keys[i]);
        }
      }
      // Phase 1: settle after grace period
      setTimeout(() => settleRace(blockHex), RACE_GRACE_MS);
      // Phase 2: finalize with penalties after timeout
      setTimeout(() => finalizeRace(blockHex), RACE_TIMEOUT_MS);
    }

    if (!race.finalized) {
      race.arrivals.set(url, now);

      // If Phase 1 already settled, eagerly record this late arrival for immediate UI update
      if (race.settled && !race.recordedDeltas.has(url)) {
        race.recordedDeltas.add(url);
        const deltaMs = Math.round(now - race.firstArrival);
        const nowSec = Math.floor(Date.now() / 1000);
        recordDelta(url, deltaMs, nowSec, stateRef.current);
      }
    }

    setRenderTick((t) => t + 1);
  }, [settleRace, finalizeRace]);

  const connectWs = useCallback((url: string) => {
    // Close existing connection if any
    const existing = wsRefs.current.get(url);
    if (existing) {
      existing.close();
      wsRefs.current.delete(url);
    }

    const state = stateRef.current.get(url);
    if (!state) return;

    try {
      const ws = new WebSocket(url);
      wsRefs.current.set(url, ws);

      ws.onopen = () => {
        state.status.connected = true;
        state.status.lastError = null;
        reconnectDelays.current.set(url, RECONNECT_INITIAL_MS);

        // Subscribe to newHeads
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_subscribe',
          params: ['newHeads'],
        }));

        setRenderTick((t) => t + 1);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // newHeads subscription response
          if (data.params?.result?.number) {
            handleNewBlock(url, data.params.result.number);
          }
        } catch {
          // Ignore parse errors
        }
      };

      ws.onerror = () => {
        state.status.lastError = 'Connection error';
        setRenderTick((t) => t + 1);
      };

      ws.onclose = () => {
        state.status.connected = false;
        wsRefs.current.delete(url);
        setRenderTick((t) => t + 1);

        // Reconnect with exponential backoff
        if (urlsRef.current.includes(url)) {
          const delay = reconnectDelays.current.get(url) || RECONNECT_INITIAL_MS;
          const nextDelay = Math.min(delay * 2, RECONNECT_MAX_MS);
          reconnectDelays.current.set(url, nextDelay);
          setTimeout(() => {
            if (urlsRef.current.includes(url)) {
              connectWs(url);
            }
          }, delay);
        }
      };
    } catch (err) {
      state.status.lastError = err instanceof Error ? err.message : 'Failed to connect';
      state.status.connected = false;
      setRenderTick((t) => t + 1);
    }
  }, [handleNewBlock]);

  // Connect/disconnect based on URLs
  useEffect(() => {
    if (urls.length === 0) return;

    for (const url of urls) {
      if (!wsRefs.current.has(url)) {
        connectWs(url);
      }
    }

    const wsMap = wsRefs.current;
    return () => {
      for (const [, ws] of wsMap) {
        ws.close();
      }
      wsMap.clear();
    };
  }, [urls, connectWs]);

  // Pause on visibility hidden
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        for (const [, ws] of wsRefs.current) {
          ws.close();
        }
        wsRefs.current.clear();
      } else {
        for (const url of urlsRef.current) {
          if (!wsRefs.current.has(url)) {
            connectWs(url);
          }
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [connectWs]);

  // Compute return values
  const wsEndpoints: WsEndpointStatus[] = [];
  const history = new Map<string, WsDeltaPoint[]>();

  for (const url of urls) {
    const state = stateRef.current.get(url);
    if (state) {
      wsEndpoints.push(state.status);
      history.set(url, state.history);
    }
  }

  void renderTick;

  return { wsEndpoints, history };
}
