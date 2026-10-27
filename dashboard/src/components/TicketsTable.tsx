import { Link } from "react-router-dom";
import { formatMoney } from "../api/parking";
import type { TicketsResponse } from "../types/parking";
import { formatDuration } from "../utils/format";

interface Props {
  data: TicketsResponse | null;
  controllerHost: string;
}

const statePill = { entered: "pill-neutral", parked: "pill-occupied", closed: "pill-free" } as const;
const stateLabel = { entered: "Entering", parked: "Parked", closed: "Paid" } as const;

export default function TicketsTable({ data, controllerHost }: Props) {
  const revenue = data?.tickets.filter((t) => t.state === "closed").reduce((sum, t) => sum + t.fee, 0) ?? 0;

  return (
    <section className="panel flex flex-col overflow-hidden">
      <div className="panel-head">
        <h2 className="panel-title">Tickets</h2>
        {data && (
          <span className="text-[12px] text-txt-secondary">
            {data.issued} issued · <span className="text-txt-primary">{formatMoney(revenue, data.currency)}</span> collected
          </span>
        )}
      </div>
      <div className="h-[340px] overflow-y-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-bg-card">
            <tr className="text-left">
              <th className="label py-2.5 pl-5 pr-3 font-medium">Ticket</th>
              <th className="label px-3 py-2.5 font-medium">Bay</th>
              <th className="label px-3 py-2.5 font-medium">Status</th>
              <th className="label px-3 py-2.5 text-right font-medium">Time</th>
              <th className="label py-2.5 pl-3 pr-5 text-right font-medium">Fee</th>
            </tr>
          </thead>
          <tbody>
            {data?.tickets.map((t) => (
              <tr key={t.id} className="border-t border-border transition-colors hover:bg-bg-card-hover">
                <td className="py-2.5 pl-5 pr-3">
                  <Link to={`/ticket/${t.id}?node=${encodeURIComponent(controllerHost)}`} target="_blank" className="font-mono text-[13px] font-semibold hover:underline">
                    #{t.id}
                  </Link>
                </td>
                <td className="px-3 py-2.5 font-mono text-[13px]">
                  {t.bay ?? <span className="text-txt-muted">→ {t.assigned_bay ?? "—"}</span>}
                </td>
                <td className="px-3 py-2.5">
                  <span className={statePill[t.state]}>{stateLabel[t.state]}</span>
                </td>
                <td className="num px-3 py-2.5 text-right text-[13px] text-txt-secondary">{formatDuration(t.duration_s)}</td>
                <td className={`num py-2.5 pl-3 pr-5 text-right text-[13px] ${t.state === "closed" ? "" : "text-txt-muted"}`}>
                  {formatMoney(t.fee, t.currency)}
                </td>
              </tr>
            ))}
            {data && data.tickets.length === 0 && (
              <tr>
                <td colSpan={5} className="py-10 text-center text-[12px] text-txt-muted">
                  No cars yet. A ticket is issued each time the gate opens.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {data && (
        <p className="border-t border-border px-5 py-2.5 text-[11px] text-txt-muted">
          {formatMoney(data.fee_per_hour, data.currency)}/hour, minimum {formatMoney(data.fee_minimum, data.currency)}
        </p>
      )}
    </section>
  );
}
