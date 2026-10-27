import { useEffect, useState } from "react";
import { getHistory } from "../api/parking";
import type { ParkingHistory } from "../types/parking";

/** Fetches GET /api/history on mount and then every `intervalMs`. */
export function useHistory(intervalMs = 5000) {
  const [history, setHistory] = useState<ParkingHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      getHistory()
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
  }, [intervalMs]);

  return { history, error };
}
