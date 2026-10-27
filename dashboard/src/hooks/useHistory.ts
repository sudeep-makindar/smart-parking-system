import { useEffect, useState } from "react";
import { getHistory } from "../api/parking";
import type { ParkingHistory } from "../types/parking";

/** Fetches GET /api/history from a controller node on mount and then every `intervalMs`. */
export function useHistory(host: string, intervalMs = 5000) {
  const [history, setHistory] = useState<ParkingHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHistory(null);
    if (!host) {
      setError("No controller node configured");
      return;
    }
    let alive = true;
    const load = () =>
      getHistory(host)
        .then((h) => {
          if (!alive) return;
          setHistory(h);
          setError(null);
        })
        .catch((err: Error) => alive && setError(err.message));
    load();
    const id = setInterval(load, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [host, intervalMs]);

  return { history, error };
}
