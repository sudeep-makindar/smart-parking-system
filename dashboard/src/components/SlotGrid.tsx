import type { SlotStatus } from "../types/parking";
import SlotCard from "./SlotCard";

interface Props {
  slots: SlotStatus[];
  recommendedId: string | null;
  stale?: boolean;
}

export default function SlotGrid({ slots, recommendedId, stale }: Props) {
  return (
    <section className="panel flex h-full flex-col">
      <div className="panel-head">
        <h2 className="panel-title">Lot</h2>
        <div className="flex items-center gap-4 text-[12px] text-txt-secondary">
          {stale && <span className="text-danger">Last known state</span>}
          <span className="flex items-center gap-1.5">
            <span className="dot bg-accent-green" /> Free
          </span>
          <span className="flex items-center gap-1.5">
            <span className="dot bg-danger" /> Occupied
          </span>
        </div>
      </div>

      <div className={`flex flex-1 flex-col justify-center px-5 pb-5 pt-6 transition-opacity ${stale ? "opacity-50" : ""}`}>
        <div className="grid grid-cols-4">
          {slots.map((slot, i) => (
            <div key={slot.id} className={i > 0 ? "-ml-[2px]" : ""}>
              <SlotCard slot={slot} recommended={slot.id === recommendedId} />
            </div>
          ))}
        </div>
        {/* drive lane */}
        <div className="relative mt-0 h-10 border-t border-dashed border-[#3a3a3a]">
          <span className="label absolute left-0 top-3">Drive lane</span>
          <span className="label absolute right-0 top-3">Entry →</span>
        </div>
      </div>
    </section>
  );
}
