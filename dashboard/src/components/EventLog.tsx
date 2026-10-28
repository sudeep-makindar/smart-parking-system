import { formatMoney } from "../api/parking";
import type { TimedEvent } from "../hooks/useEvents";

interface Props {
  events: TimedEvent[];
  currency: string;
  /** Map ticket id -> final fee, for "ticket closed" rows */
  fees: Record<number, number>;
}

const tone: Record<string, string> = {
  slot_occupied: "bg-danger",
  slot_free: "bg-accent-green",
  gate_open: "bg-txt-primary",
  gate_close: "bg-txt-muted",
  entry_denied: "bg-amber-400",
  ticket_issued: "bg-txt-primary",
  ticket_closed: "bg-accent-green",
  cam_online: "bg-accent-green",
  cam_offline: "bg-danger",
  gate_mode: "bg-txt-secondary",
};

function describe(e: TimedEvent, currency: string, fees: Record<number, number>) {
  switch (e.type) {
    case "slot_occupied":
      return <><b>{e.slot}</b> occupied <span className="text-txt-muted">· score {e.value}%</span></>;
    case "slot_free":
      return <><b>{e.slot}</b> is free</>;
    case "gate_open":
      return "Gate opened";
    case "gate_close":
      return "Gate closed";
    case "entry_denied":
      return <span className="text-amber-300">Car refused, {e.value === 1 ? "gate held closed" : "lot full"}</span>;
    case "ticket_issued":
      return <>Ticket <b>#{e.value}</b> issued <span className="text-txt-muted">→ {e.slot ?? "—"}</span></>;
    case "ticket_closed":
      return (
        <>
          Ticket <b>#{e.value}</b> paid{" "}
          {fees[e.value] !== undefined && <span className="text-accent-green">{formatMoney(fees[e.value], currency)}</span>}
        </>
      );
    case "cam_online":
      return "Camera link up (ESP-NOW)";
    case "cam_offline":
      return <span className="text-danger">Camera link lost (ESP-NOW)</span>;
    case "gate_mode":
      return <>Gate set to <b>{["Auto", "Open", "Closed"][e.value] ?? "?"}</b> from the dashboard</>;
  }
}

export default function EventLog({ events, currency, fees }: Props) {
  const rows = events.filter((e) => e.type !== "gate_close").slice(-80).reverse();

  return (
    <section className="panel flex flex-col">
      <div className="panel-head">
        <h2 className="panel-title">Activity</h2>
        <span className="text-[12px] text-txt-secondary">{events.length} events</span>
      </div>
      <ol className="h-[340px] overflow-y-auto px-5 py-2">
        {rows.length === 0 && <li className="py-6 text-center text-[12px] text-txt-muted">Nothing yet</li>}
        {rows.map((e) => (
          <li key={e.seq} className="flex animate-fade-in items-baseline gap-3 py-1.5 text-[13px] [&_b]:font-mono [&_b]:font-semibold">
            <span className="num w-[60px] shrink-0 font-mono text-[11px] text-txt-muted">
              {new Date(e.at).toLocaleTimeString([], { hour12: false })}
            </span>
            <span className={`dot relative -top-px ${tone[e.type]}`} />
            <span className="min-w-0 text-txt-secondary [&_b]:text-txt-primary">{describe(e, currency, fees)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
