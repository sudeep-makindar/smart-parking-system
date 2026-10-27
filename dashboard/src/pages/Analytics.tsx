import EventLog from "../components/EventLog";
import OccupancyChart from "../components/OccupancyChart";
import SlotUsageCard from "../components/SlotUsageCard";
import StatsCard from "../components/StatsCard";
import SystemInfo from "../components/SystemInfo";
import TicketsTable from "../components/TicketsTable";
import Timeline from "../components/Timeline";
import { useEvents } from "../hooks/useEvents";
import { useTickets } from "../hooks/useTickets";
import { useNodes } from "../hooks/useNodes";
import { useConfig } from "../hooks/useConfig";
import { useHistory } from "../hooks/useHistory";
import type { ParkingStatus } from "../types/parking";
import { formatHms } from "../utils/format";

interface Props {
  data: ParkingStatus;
}

export default function Analytics({ data }: Props) {
  const { camera, controller } = useNodes();
  const ctrlHost = controller?.host.trim() ?? "";
  const { history, error } = useHistory(ctrlHost, 5000);
  const { config } = useConfig(camera?.host.trim() ?? "");
  const { events } = useEvents(ctrlHost, 2000);
  const { tickets } = useTickets(ctrlHost, 3000);
  const fees = Object.fromEntries(
    (tickets?.tickets ?? []).filter((t) => t.state === "closed").map((t) => [t.id, t.fee]),
  );
  const occupied = data.total_slots - data.free_count;
  const rate = data.total_slots ? Math.round((occupied / data.total_slots) * 100) : 0;
  const sessionSeconds = history?.uptime_s ?? data.uptime_s;
  const avgUtil =
    history && sessionSeconds > 0
      ? Math.round(
          (history.slots.reduce((sum, s) => sum + s.total_occupied_s, 0) / (sessionSeconds * history.slots.length)) *
            100,
        )
      : 0;
  const tHigh = (config?.t_high ?? 0.3) * 100;
  const tLow = (config?.t_low ?? 0.15) * 100;

  return (
    <div className="space-y-4">
      <div className="panel grid grid-cols-2 divide-border md:grid-cols-4 md:divide-x [&>*:nth-child(-n+2)]:border-b [&>*:nth-child(-n+2)]:border-border md:[&>*:nth-child(-n+2)]:border-b-0 [&>*:nth-child(even)]:border-l [&>*:nth-child(even)]:border-border">
        <StatsCard label="Occupancy rate" value={`${rate}%`} tone={rate === 100 ? "occupied" : "default"} hint={`${occupied} of ${data.total_slots} occupied now`} />
        <StatsCard label="Session average" value={`${avgUtil}%`} hint="Mean bay utilisation" />
        <StatsCard
          label="Cars entered"
          value={data.cars_entered}
          hint={`${data.cars_denied} refused`}
        />
        <StatsCard label="Uptime" value={<span className="font-mono text-[26px]">{formatHms(data.uptime_s)}</span>} hint="Since controller boot" />
      </div>

      <Timeline events={events} slots={data.slots} />

      <div className="grid gap-4 lg:grid-cols-2">
        <EventLog events={events} currency={tickets?.currency ?? "INR"} fees={fees} />
        <TicketsTable data={tickets} controllerHost={ctrlHost} />
      </div>

      {history ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <OccupancyChart slots={history.slots} sessionSeconds={sessionSeconds} />

          <section className="panel overflow-hidden">
            <div className="panel-head">
              <h2 className="panel-title">Bay usage</h2>
              <span className="text-[12px] text-txt-secondary">This session</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left">
                    <th className="label py-2.5 pl-5 pr-3 font-medium">Bay</th>
                    <th className="label px-3 py-2.5 font-medium">Status</th>
                    <th className="label px-3 py-2.5 text-right font-medium">Current</th>
                    <th className="label px-3 py-2.5 text-right font-medium">Total</th>
                    <th className="label py-2.5 pl-3 pr-5 text-right font-medium">Changes</th>
                  </tr>
                </thead>
                <tbody>
                  {history.slots.map((s) => {
                    const live = data.slots.find((x) => x.id === s.id);
                    return (
                      <SlotUsageCard
                        key={s.id}
                        slot={s}
                        occupied={live?.occupied ?? false}
                        occupiedForS={live?.occupied_for_s ?? 0}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : (
        <div className="panel px-5 py-10 text-center text-[13px] text-txt-secondary">
          {error ? <span className="text-danger">History unavailable: {error}</span> : "Loading history…"}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title">Detection scores</h2>
            <span className="flex items-center gap-3 text-[11px] text-txt-muted">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-px bg-txt-secondary" /> T_LOW {tLow.toFixed(0)}%
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-px bg-txt-primary" /> T_HIGH {tHigh.toFixed(0)}%
              </span>
            </span>
          </div>
          <div className="space-y-4 px-5 py-5">
            {data.slots.map((s) => (
              <div key={s.id} className="grid grid-cols-[2.5rem_1fr_3rem] items-center gap-4">
                <span className="font-mono text-[13px] font-semibold">{s.id}</span>
                <div className="relative h-1.5 rounded-full bg-white/[0.06]">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${s.occupied ? "bg-danger" : "bg-accent-green"}`}
                    style={{ width: `${Math.min(100, s.score)}%` }}
                  />
                  <span className="absolute -top-1 h-3.5 w-px bg-txt-secondary" style={{ left: `${tLow}%` }} />
                  <span className="absolute -top-1 h-3.5 w-px bg-txt-primary" style={{ left: `${tHigh}%` }} />
                </div>
                <span className="num text-right font-mono text-[12px] text-txt-secondary">{s.score}%</span>
              </div>
            ))}
          </div>
        </section>

        <SystemInfo
          title="System"
          items={[
            { label: "Uptime", value: formatHms(data.uptime_s), mono: true },
            { label: "Camera node", value: data.sources.camera ? "Online" : <span className="text-danger">Offline</span> },
            { label: "Controller node", value: data.sources.controller ? "Online" : <span className="text-danger">Offline</span> },
            { label: "Gate", value: `${data.gate_open ? "Open" : "Closed"} (${data.gate_mode})` },
            {
              label: "Session started",
              value:
                history && history.session_start > 1_000_000_000
                  ? new Date(history.session_start * 1000).toLocaleString()
                  : "At boot",
            },
          ]}
        />
      </div>
    </div>
  );
}
