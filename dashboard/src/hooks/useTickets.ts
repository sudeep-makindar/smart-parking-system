import { useEffect, useState } from "react";
import { getTickets } from "../api/parking";
import type { TicketsResponse } from "../types/parking";

export function useTickets(intervalMs = 3000) {
  const [tickets, setTickets] = useState<TicketsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      getTickets()
        .then((t) => {
          if (!alive) return;
          setTickets(t);
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

  return { tickets, error };
}
