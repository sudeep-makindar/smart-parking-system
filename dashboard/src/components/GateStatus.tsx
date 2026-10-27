import { formatAgo } from "../utils/format";

interface Props {
  gateOpen: boolean;
  irActive: boolean;
  lastEntryAgoS: number;
  carsEntered: number;
}

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

export default function GateStatus({ gateOpen, irActive, lastEntryAgoS, carsEntered }: Props) {
  return (
    <section className="panel p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="label">Entry gate</p>
          <p key={String(gateOpen)} className="mt-4 animate-fade-in text-[44px] font-semibold leading-none tracking-tight">
            {gateOpen ? <span className="text-accent-green">Open</span> : "Closed"}
          </p>
        </div>
        <Barrier open={gateOpen} />
      </div>

      <dl className="mt-5 grid grid-cols-3 border-t border-border pt-4">
        <div>
          <dt className="label">IR sensor</dt>
          <dd className="mt-1.5 flex items-center gap-1.5 text-[13px] font-medium">
            <span className={`dot ${irActive ? "bg-accent-green" : "bg-txt-muted"}`} />
            {irActive ? "Car detected" : "Clear"}
          </dd>
        </div>
        <div>
          <dt className="label">Last entry</dt>
          <dd className="mt-1.5 text-[13px] font-medium">{formatAgo(lastEntryAgoS)}</dd>
        </div>
        <div>
          <dt className="label">Entries</dt>
          <dd className="num mt-1.5 text-[13px] font-medium">{carsEntered}</dd>
        </div>
      </dl>
    </section>
  );
}
