import { useState } from "react";
import { setGateMode } from "../api/parking";
import type { GateMode, ParkingStatus } from "../types/parking";
import { formatAgo } from "../utils/format";

interface Props {
  data: ParkingStatus;
  controllerHost: string;
}

const MODES: { id: GateMode; label: string; hint: string }[] = [
  { id: "auto", label: "Auto", hint: "Opens for a car at the IR sensor when a slot is free" },
  { id: "open", label: "Open", hint: "Hold the barrier open" },
  { id: "closed", label: "Close", hint: "Hold the barrier closed; arriving cars are refused" },
];

function Barrier({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 120 56" className="h-14 w-[120px]" aria-hidden>
      <line x1="0" y1="54" x2="120" y2="54" stroke="#2a2a2a" strokeWidth="2" />
      <rect x="8" y="22" width="10" height="32" rx="2" fill="#2e2e2e" />
      <g
        style={{
          transform: `rotate(${open ? -70 : 0}deg)`,
          transformOrigin: "13px 28px",
          transition: "transform 0.8s cubic-bezier(.3,.7,.3,1)",
        }}
      >
        <rect x="13" y="25" width="104" height="5" rx="2.5" fill={open ? "#e5e5e5" : "#9a9a9a"} />
      </g>
      <circle cx="13" cy="28" r="3" fill={open ? "var(--accent-green)" : "var(--danger-red)"} />
    </svg>
  );
}

export default function GateStatus({ data, controllerHost }: Props) {
  const [pending, setPending] = useState<GateMode | null>(null);
  const [error, setError] = useState("");
  const live = data.sources.controller;

  const choose = async (mode: GateMode) => {
    setPending(mode);
    setError("");
    try {
      const res = await setGateMode(controllerHost, mode);
      if (!res.ok) throw new Error(res.error ?? "Rejected");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="panel flex flex-col p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="label">Entry gate</p>
          <p key={String(data.gate_open)} className="mt-4 animate-fade-in text-[44px] font-semibold leading-none tracking-tight">
            {data.gate_open ? <span className="text-accent-green">Open</span> : "Closed"}
          </p>
          <p className="mt-2 text-[12px] text-txt-secondary">
            {data.gate_mode === "auto" ? "Automatic" : "Manual hold"} · servo {data.servo_angle}°
          </p>
        </div>
        <Barrier open={data.gate_open} />
      </div>

      <div className="mt-5 grid grid-cols-3 gap-1 rounded-lg border border-border p-1" role="radiogroup" aria-label="Gate mode">
        {MODES.map((m) => {
          const active = data.gate_mode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={active}
              title={m.hint}
              disabled={!live || pending !== null}
              onClick={() => choose(m.id)}
              className={`h-8 rounded-md text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                active ? "bg-txt-primary text-black" : "text-txt-secondary hover:bg-bg-card-hover hover:text-txt-primary"
              }`}
            >
              {pending === m.id ? "…" : m.label}
            </button>
          );
        })}
      </div>
      {(error || !live) && (
        <p className="mt-2 text-[12px] text-danger">{error || "Controller node offline: gate controls unavailable."}</p>
      )}

      <dl className="mt-5 grid grid-cols-3 border-t border-border pt-4">
        <div>
          <dt className="label">Last entry</dt>
          <dd className="mt-1.5 text-[13px] font-medium">{formatAgo(data.last_entry_ago_s)}</dd>
        </div>
        <div>
          <dt className="label">Entered</dt>
          <dd className="num mt-1.5 text-[13px] font-medium">{data.cars_entered}</dd>
        </div>
        <div>
          <dt className="label">Refused</dt>
          <dd className="num mt-1.5 text-[13px] font-medium">{data.cars_denied}</dd>
        </div>
      </dl>
    </section>
  );
}
