import { useEffect, useState } from "react";
import { getTickets } from "../api/parking";
import type { TicketsResponse } from "../types/parking";

export function useTickets(host: string, intervalMs = 3000) {
  const [tickets, setTickets] = useState<TicketsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTickets(null);
    if (!host) return;
    let alive = true;
    const load = () =>
      getTickets(host)
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
  }, [host, intervalMs]);

  return { tickets, error };
}
