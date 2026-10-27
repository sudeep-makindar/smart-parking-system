import { useCallback, useEffect, useRef, useState } from "react";
import { getStatus, syncTime } from "../api/parking";
import type { ParkingStatus } from "../types/parking";

const POLL_MS = 1500;
const QUALITY_WINDOW = 20;

export interface ParkingState {
  data: ParkingStatus | null;
  isConnected: boolean;
  error: string | null;
  lastUpdated: Date | null;
  /** Round-trip time of the last successful poll */
  latencyMs: number | null;
  /** Share of the last 20 polls that succeeded (0–1) */
  successRate: number;
  refresh: () => void;
}

/** Polls GET /api/status every 1.5 s. Keeps the last good data when a poll fails. */
export function useParking(): ParkingState {
  const [data, setData] = useState<ParkingStatus | null>(null);
  const [isConnected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [latencyMs, setLatency] = useState<number | null>(null);
  const [successRate, setSuccessRate] = useState(0);

  const results = useRef<boolean[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const timeSynced = useRef(false);
  const alive = useRef(true);

  const record = (ok: boolean) => {
    results.current = [...results.current, ok].slice(-QUALITY_WINDOW);
    setSuccessRate(results.current.filter(Boolean).length / results.current.length);
  };

  const poll = useCallback(async () => {
    clearTimeout(timer.current);
    const started = performance.now();
    try {
      const status = await getStatus();
      if (!alive.current) return;
      setData(status);
      setConnected(true);
      setError(null);
      setLastUpdated(new Date());
      setLatency(Math.round(performance.now() - started));
      record(true);
      if (!status.time_synced && !timeSynced.current) {
        timeSynced.current = true;
        syncTime().catch(() => {
          timeSynced.current = false;
        });
      }
    } catch (err) {
      if (!alive.current) return;
      setConnected(false);
      setError(err instanceof Error ? err.message : String(err));
      record(false);
    }
    // Chain timeouts instead of setInterval so slow responses never overlap
    if (alive.current) timer.current = setTimeout(poll, POLL_MS);
  }, []);

  useEffect(() => {
    alive.current = true;
    poll();
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, [poll]);

  return { data, isConnected, error, lastUpdated, latencyMs, successRate, refresh: poll };
}
