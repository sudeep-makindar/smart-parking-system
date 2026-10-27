import VisionView from "../components/VisionView";
import { useConfig } from "../hooks/useConfig";
import type { ParkingState } from "../hooks/useParking";
import type { ParkingStatus } from "../types/parking";
import { formatDuration } from "../utils/format";

interface Props {
  data: ParkingStatus;
  parking: ParkingState;
}

function quality(rate: number, latency: number | null): { label: string; bars: number; tone: string } {
  if (rate < 0.5 || latency === null) return { label: "Poor", bars: 1, tone: "text-danger" };
  if (rate < 0.9 || latency > 600) return { label: "Fair", bars: 2, tone: "text-amber-400" };
  if (latency > 250) return { label: "Good", bars: 3, tone: "text-txt-primary" };
  return { label: "Excellent", bars: 4, tone: "text-accent-green" };
}

export default function LiveFeedPage({ data, parking }: Props) {
  const q = quality(parking.successRate, parking.latencyMs);
  const { config } = useConfig();

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <VisionView data={data} config={config} />

      <div className="space-y-4">
        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title">Connection</h2>
            <span className={`flex items-center gap-2 text-[12px] font-medium ${q.tone}`}>
              <span className="flex h-3 items-end gap-[2px]" aria-hidden>
                {[1, 2, 3, 4].map((b) => (
                  <span
                    key={b}
                    className={`w-[3px] rounded-[1px] ${b <= q.bars ? "bg-current" : "bg-white/10"}`}
                    style={{ height: `${b * 25}%` }}
                  />
                ))}
              </span>
              {q.label}
            </span>
          </div>
          <dl className="divide-y divide-border px-5">
            <div className="kv">
              <dt>API latency</dt>
              <dd className="num">{parking.latencyMs !== null ? `${parking.latencyMs} ms` : "—"}</dd>
            </div>
            <div className="kv">
              <dt>Poll success</dt>
              <dd className="num">{Math.round(parking.successRate * 100)}%</dd>
            </div>
            <div className="kv">
              <dt>Camera last packet</dt>
              <dd className={`num ${data.cam_online ? "" : "text-danger"}`}>
                {data.cam_last_seen_ms >= 0 ? `${data.cam_last_seen_ms} ms ago` : "never"}
              </dd>
            </div>
            <div className="kv">
              <dt>Last update</dt>
              <dd className="num">{parking.lastUpdated?.toLocaleTimeString([], { hour12: false }) ?? "—"}</dd>
            </div>
          </dl>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title">Bays</h2>
            <span className="text-[12px] text-txt-secondary">{data.free_count} free</span>
          </div>
          <ul className="divide-y divide-border px-5">
            {data.slots.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2.5 text-[13px]">
                <span className="font-mono font-semibold">{s.id}</span>
                <span className="num text-txt-secondary">
                  {s.occupied ? formatDuration(s.occupied_for_s) : `score ${s.score}%`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
