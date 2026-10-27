import { useEffect, useRef, useState } from "react";

const QUALITY_WINDOW = 20;

export interface Polled<T> {
  data: T | null;
  isConnected: boolean;
  error: string | null;
  lastUpdated: Date | null;
  /** Round-trip time of the last successful poll */
  latencyMs: number | null;
  /** Share of the last 20 polls that succeeded (0–1) */
  successRate: number;
}

/**
 * Calls `fetcher` every `intervalMs` (chained, never overlapping) while `key`
 * is non-empty. Keeps the last good data when a poll fails. Changing `key`
 * (e.g. a node's IP) starts over.
 */
export function usePolling<T>(key: string, fetcher: () => Promise<T>, intervalMs: number): Polled<T> {
  const [state, setState] = useState<Polled<T>>({
    data: null,
    isConnected: false,
    error: null,
    lastUpdated: null,
    latencyMs: null,
    successRate: 0,
  });
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  useEffect(() => {
    setState({ data: null, isConnected: false, error: key ? null : "Not configured", lastUpdated: null, latencyMs: null, successRate: 0 });
    if (!key) return;

    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const results: boolean[] = [];
    const record = (ok: boolean) => {
      results.push(ok);
      if (results.length > QUALITY_WINDOW) results.shift();
      return results.filter(Boolean).length / results.length;
    };

    const poll = async () => {
      const started = performance.now();
      try {
        const data = await fetchRef.current();
        if (!alive) return;
        const successRate = record(true);
        setState({
          data,
          isConnected: true,
          error: null,
          lastUpdated: new Date(),
          latencyMs: Math.round(performance.now() - started),
          successRate,
        });
      } catch (err) {
        if (!alive) return;
        const successRate = record(false);
        setState((prev) => ({ ...prev, isConnected: false, error: err instanceof Error ? err.message : String(err), successRate }));
      }
      if (alive) timer = setTimeout(poll, intervalMs);
    };
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key, intervalMs]);

  return state;
}
