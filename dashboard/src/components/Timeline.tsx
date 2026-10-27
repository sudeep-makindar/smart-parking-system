import { useEffect, useMemo, useState } from "react";
import type { TimedEvent } from "../hooks/useEvents";
import type { SlotStatus } from "../types/parking";

const WINDOWS = [
  { id: "5m", label: "5 min", ms: 5 * 60_000 },
  { id: "15m", label: "15 min", ms: 15 * 60_000 },
  { id: "1h", label: "1 hour", ms: 60 * 60_000 },
] as const;

interface Props {
  events: TimedEvent[];
  slots: SlotStatus[];
}

interface Segment {
  start: number;
  end: number;
}

/** Occupied periods for one bay, reconstructed from its slot events. */
function segmentsFor(id: string, events: TimedEvent[], occupiedNow: boolean, now: number): Segment[] {
  const own = events.filter((e) => e.slot === id && (e.type === "slot_occupied" || e.type === "slot_free"));
  const segments: Segment[] = [];
  // Before the first known event the bay was in the opposite state of that event
  let start: number | null = own.length ? (own[0].type === "slot_free" ? 0 : null) : occupiedNow ? 0 : null;
  for (const e of own) {
    if (e.type === "slot_occupied" && start === null) start = e.at;
    if (e.type === "slot_free" && start !== null) {
      segments.push({ start, end: e.at });
      start = null;
    }
  }
  if (start !== null) segments.push({ start, end: now });
  return segments;
}

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

export default function Timeline({ events, slots }: Props) {
  const [win, setWin] = useState<(typeof WINDOWS)[number]>(WINDOWS[1]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const from = now - win.ms;
  const x = (t: number) => `${Math.max(0, ((t - from) / win.ms) * 100)}%`;
  const w = (s: number, e: number) => `${Math.max(0.3, ((Math.min(e, now) - Math.max(s, from)) / win.ms) * 100)}%`;

  const rows = useMemo(
    () => slots.map((s) => ({ id: s.id, segments: segmentsFor(s.id, events, s.occupied, now) })),
    [slots, events, now],
  );
  const gateMarks = events.filter((e) => (e.type === "gate_open" || e.type === "entry_denied") && e.at >= from);
  const ticks = Array.from({ length: 5 }, (_, i) => from + (win.ms / 4) * i);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Timeline</h2>
        <div className="flex rounded-lg border border-border p-0.5">
          {WINDOWS.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setWin(o)}
              className={`rounded-md px-2.5 py-0.5 text-[12px] font-medium transition-colors ${
                win.id === o.id ? "bg-white/10 text-txt-primary" : "text-txt-secondary hover:text-txt-primary"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 pb-4 pt-5">
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="grid grid-cols-[2.75rem_1fr] items-center gap-3">
              <span className="font-mono text-[12px] font-semibold">{r.id}</span>
              <div className="relative h-6 overflow-hidden rounded-[5px] bg-accent-green/[0.07]">
                {r.segments
                  .filter((s) => s.end >= from)
                  .map((s) => (
                    <div
                      key={s.start}
                      className="absolute inset-y-0 bg-danger/80 transition-[width] duration-1000 ease-linear"
                      style={{ left: x(s.start), width: w(s.start, s.end) }}
                      title={`${clock(Math.max(s.start, from))} – ${s.end >= now ? "now" : clock(s.end)}`}
                    />
                  ))}
              </div>
            </div>
          ))}

          <div className="grid grid-cols-[2.75rem_1fr] items-center gap-3">
            <span className="label">Gate</span>
            <div className="relative h-6 border-b border-dashed border-border">
              {gateMarks.map((e) => (
                <span
                  key={e.seq}
                  className={`absolute bottom-0 h-4 w-[2px] rounded-full ${
                    e.type === "gate_open" ? "bg-txt-primary" : "bg-amber-400"
                  }`}
                  style={{ left: x(e.at) }}
                  title={`${clock(e.at)} ${e.type === "gate_open" ? "car entered" : "turned away (full)"}`}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="mt-2 grid grid-cols-[2.75rem_1fr] gap-3">
          <span />
          <div className="relative h-4">
            {ticks.map((t, i) => (
              <span
                key={i}
                className={`num absolute text-[10px] text-txt-muted ${
                  i === 0 ? "" : i === ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2"
                }`}
                style={{ left: `${(i / (ticks.length - 1)) * 100}%` }}
              >
                {i === ticks.length - 1 ? "now" : clock(t)}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-txt-secondary">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-[2px] bg-danger/80" /> Occupied
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-[2px] bg-accent-green/[0.15]" /> Free
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-[2px] bg-txt-primary" /> Car entered
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-[2px] bg-amber-400" /> Turned away
          </span>
        </div>
      </div>
    </section>
  );
}
