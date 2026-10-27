import type { SlotHistory } from "../types/parking";
import { formatDuration } from "../utils/format";

interface Props {
  slot: SlotHistory;
  occupied: boolean;
  occupiedForS: number;
}

/** One row of the bay usage table. */
export default function SlotUsageCard({ slot, occupied, occupiedForS }: Props) {
  return (
    <tr className="border-t border-border transition-colors hover:bg-bg-card-hover">
      <td className="py-3 pl-5 pr-3 font-mono text-[13px] font-semibold">{slot.id}</td>
      <td className="px-3 py-3">
        <span className={occupied ? "pill-occupied" : "pill-free"}>{occupied ? "Occupied" : "Free"}</span>
      </td>
      <td className="num px-3 py-3 text-right text-[13px] text-txt-secondary">
        {occupied && occupiedForS > 0 ? formatDuration(occupiedForS) : "—"}
      </td>
      <td className="num px-3 py-3 text-right text-[13px]">{formatDuration(slot.total_occupied_s)}</td>
      <td className="num py-3 pl-3 pr-5 text-right text-[13px]">{slot.change_count}</td>
    </tr>
  );
}
