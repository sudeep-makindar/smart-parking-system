import type { SlotStatus } from "../types/parking";
import { formatDuration } from "../utils/format";

interface Props {
  slot: SlotStatus;
  recommended?: boolean;
}

/** One painted parking bay, seen from above. The car slides in from the lane when occupied. */
export default function SlotCard({ slot, recommended }: Props) {
  const { id, occupied, score, occupied_for_s } = slot;

  return (
    <div
      className={`relative flex aspect-[3/4] flex-col justify-between border-x-2 border-t-2 border-[#3a3a3a] p-3 transition-colors duration-500 ${
        occupied ? "bg-danger/[0.04]" : recommended ? "bg-accent-green/[0.04]" : ""
      }`}
    >
      <div className="relative z-10 flex items-start justify-between gap-2">
        <span className="font-mono text-[13px] font-semibold">{id}</span>
        <span className={`${occupied ? "pill-occupied" : "pill-free"} hidden sm:inline-flex`}>{occupied ? "Occupied" : "Free"}</span>
      </div>

      {/* car */}
      <div
        className={`absolute inset-x-[22%] top-[22%] bottom-[16%] rounded-[10px] border border-danger/50 bg-[#2a1a1a] transition-all duration-700 ease-out ${
          occupied ? "translate-y-0 opacity-100" : "translate-y-1/3 opacity-0"
        }`}
        aria-hidden
      >
        <div className="absolute inset-x-[14%] top-[14%] h-[18%] rounded-[4px] border border-danger/30" />
        <div className="absolute inset-x-[14%] bottom-[12%] h-[12%] rounded-[4px] border border-danger/20" />
      </div>

      {!occupied && recommended && (
        <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[11px] font-medium uppercase tracking-[0.08em] text-accent-green animate-fade-in">
          Next
        </span>
      )}

      <div className="relative z-10 flex items-end justify-between text-[11px] text-txt-secondary">
        <span className="num">{score}%</span>
        {occupied && occupied_for_s > 0 && <span className="num">{formatDuration(occupied_for_s)}</span>}
      </div>
    </div>
  );
}
