import { useEffect, useRef, useState } from "react";
import { getEvents } from "../api/parking";
import type { ParkingEvent } from "../types/parking";

export interface TimedEvent extends ParkingEvent {
  /** Wall-clock time (ms since epoch) in the browser's clock */
  at: number;
}

const MAX_EVENTS = 600;

/**
 * Incrementally fetches /api/events from a controller node and keeps everything seen since the page
 * opened. Controller timestamps (millis since boot) are mapped to wall time.
 */
export function useEvents(host: string, intervalMs = 2000) {
  const [events, setEvents] = useState<TimedEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const lastSeq = useRef(0);

  useEffect(() => {
    setEvents([]);
    lastSeq.current = 0;
    if (!host) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await getEvents(host, lastSeq.current);
        if (!alive) return;
        const now = Date.now();
        const mapped = res.events.map((e) => ({ ...e, at: now - (res.uptime_ms - e.t_ms) }));
        if (res.seq < lastSeq.current) {
          // Controller rebooted: start over
          lastSeq.current = res.seq;
          setEvents(mapped);
        } else if (mapped.length) {
          lastSeq.current = res.seq;
          setEvents((prev) => [...prev, ...mapped].slice(-MAX_EVENTS));
        }
        setError(null);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    };
    load();
    const id = setInterval(load, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [host, intervalMs]);

  return { events, error };
}
