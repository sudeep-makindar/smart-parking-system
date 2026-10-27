import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { formatMoney, getTicket } from "../api/parking";
import { useNodes } from "../hooks/useNodes";
import type { Ticket } from "../types/parking";
import { formatHms } from "../utils/format";

/** Phone view of one parking ticket, opened by scanning the QR at the gate. */
export default function TicketPage() {
  const { id } = useParams();
  const ticketId = Number(id);
  // The QR code carries the controller's address, so a phone without saved nodes can still load it
  const [params] = useSearchParams();
  const { controller } = useNodes();
  const host = params.get("node") ?? controller?.host.trim() ?? "";
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [fetchedAt, setFetchedAt] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () =>
      getTicket(host, ticketId)
        .then((t) => {
          if (!alive) return;
          setTicket(t);
          setFetchedAt(Date.now());
          setError(null);
        })
        .catch((err: Error) => alive && setError(err.message));
    load();
    const poll = setInterval(load, 3000);
    const clock = setInterval(() => setTick((n) => n + 1), 1000);
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [ticketId, host]);

  const live = ticket && ticket.state !== "closed";
  const elapsed = ticket ? ticket.duration_s + (live ? Math.floor((Date.now() - fetchedAt) / 1000) : 0) : 0;
  const entered = ticket ? new Date(fetchedAt - ticket.entry_ago_s * 1000) : null;
  const bay = ticket?.bay ?? ticket?.assigned_bay ?? "—";

  const headline =
    ticket?.state === "closed"
      ? "Paid · thank you"
      : ticket?.state === "parked"
        ? `Parked in ${bay}`
        : `Head to bay ${bay}`;

  return (
    <div className="min-h-dvh bg-bg-primary px-4 py-8">
      <div className="mx-auto max-w-sm">
        <p className="mb-6 flex items-center justify-center gap-2 text-[13px] text-txt-secondary">
          <span className="grid h-5 w-5 place-items-center rounded bg-white text-[11px] font-bold text-black">P</span>
          Smart Parking · Zone A
        </p>

        {error && !ticket ? (
          <div className="panel p-6 text-center">
            <p className="text-[15px] font-semibold">Ticket not found</p>
            <p className="mt-2 text-[13px] text-txt-secondary">
              {error}. Make sure this phone is on the same Wi-Fi as the parking system.
            </p>
          </div>
        ) : !ticket ? (
          <div className="panel p-6 text-center text-[13px] text-txt-secondary">Loading ticket…</div>
        ) : (
          <div className="panel overflow-hidden animate-fade-in">
            <div className="flex items-center justify-between px-6 pt-6">
              <p className="label">Parking ticket</p>
              <p className="font-mono text-[13px] font-semibold">#{ticket.id}</p>
            </div>

            <div className="px-6 pb-6 pt-8 text-center">
              <p
                className={`text-[96px] font-semibold leading-none tracking-tight ${
                  ticket.state === "closed" ? "text-txt-secondary" : "text-accent-green"
                }`}
              >
                {bay}
              </p>
              <p className="mt-3 text-[15px] font-medium">{headline}</p>
            </div>

            <div className="relative border-t border-dashed border-border">
              <span className="absolute -left-2.5 -top-2.5 h-5 w-5 rounded-full bg-bg-primary" />
              <span className="absolute -right-2.5 -top-2.5 h-5 w-5 rounded-full bg-bg-primary" />
            </div>

            <dl className="divide-y divide-border px-6">
              <div className="kv">
                <dt>Entered</dt>
                <dd className="num">{entered?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}</dd>
              </div>
              <div className="kv">
                <dt>{live ? "Time so far" : "Total time"}</dt>
                <dd className="num font-mono">{formatHms(elapsed)}</dd>
              </div>
              <div className="kv">
                <dt>{live ? "Fee so far" : "Amount paid"}</dt>
                <dd className={`num text-[18px] font-semibold ${live ? "" : "text-accent-green"}`}>
                  {formatMoney(ticket.fee, ticket.currency)}
                </dd>
              </div>
            </dl>

            <p className="border-t border-border px-6 py-3 text-center text-[11px] text-txt-muted">
              {live ? "Updates live. The fee is settled automatically when your car leaves the bay." : "Have a safe drive."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
