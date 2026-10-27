import type { SlotHistory } from "../types/parking";
import { formatDuration } from "../utils/format";

interface Props {
  slots: SlotHistory[];
  sessionSeconds: number;
}

const TICKS = [0, 25, 50, 75, 100];

/** Horizontal bars: share of this session each bay spent occupied. */
export default function OccupancyChart({ slots, sessionSeconds }: Props) {
  const pct = (s: SlotHistory) =>
    sessionSeconds > 0 ? Math.min(100, (s.total_occupied_s / sessionSeconds) * 100) : 0;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Occupancy by bay</h2>
        <span className="text-[12px] text-txt-secondary">Share of session occupied</span>
      </div>

      <div className="px-5 pb-4 pt-5">
        <div className="space-y-4">
          {slots.map((s) => {
            const p = pct(s);
            return (
              <div key={s.id} className="grid grid-cols-[2.5rem_1fr_5.5rem] items-center gap-4">
                <span className="font-mono text-[13px] font-semibold">{s.id}</span>
                <div className="relative h-7 rounded-[6px] bg-white/[0.03]">
                  {TICKS.slice(1, -1).map((t) => (
                    <span key={t} className="absolute inset-y-0 w-px bg-white/[0.05]" style={{ left: `${t}%` }} />
                  ))}
                  <div
                    className="h-full rounded-[6px] bg-accent-soft/80 transition-[width] duration-700 ease-out"
                    style={{ width: `${p}%` }}
                  />
                </div>
                <div className="text-right">
                  <p className="num text-[13px] font-semibold">{Math.round(p)}%</p>
                  <p className="num text-[11px] text-txt-muted">{formatDuration(s.total_occupied_s)}</p>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-2 grid grid-cols-[2.5rem_1fr_5.5rem] gap-4">
          <span />
          <div className="relative h-4">
            {TICKS.map((t) => (
              <span
                key={t}
                className="num absolute -translate-x-1/2 text-[10px] text-txt-muted first:translate-x-0 last:-translate-x-full"
                style={{ left: `${t}%` }}
              >
                {t}%
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
