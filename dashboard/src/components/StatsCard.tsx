import type { ReactNode } from "react";

type Tone = "default" | "free" | "occupied";

interface Props {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}

const toneClass: Record<Tone, string> = {
  default: "text-txt-primary",
  free: "text-accent-green",
  occupied: "text-danger",
};

/** One cell of a stats strip. Place several inside a `.panel` with dividers. */
export default function StatsCard({ label, value, hint, tone = "default" }: Props) {
  return (
    <div className="px-5 py-4">
      <p className="label">{label}</p>
      <p className={`num mt-2 text-[30px] font-semibold leading-none tracking-tight ${toneClass[tone]}`}>{value}</p>
      {hint && <p className="mt-2 text-[12px] text-txt-secondary">{hint}</p>}
    </div>
  );
}
