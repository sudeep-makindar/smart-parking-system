import { guidanceSlot } from "../utils/format";

interface Props {
  guidance: string;
  freeCount: number;
  camOnline: boolean;
}

export default function GuidancePanel({ guidance, freeCount, camOnline }: Props) {
  const slot = guidanceSlot(guidance);
  const full = freeCount === 0;

  return (
    <section className="panel flex flex-col justify-between p-5">
      <p className="label">Next available</p>
      <div key={full ? "full" : slot ?? guidance} className="mt-4 animate-fade-in">
        {full ? (
          <p className="text-[44px] font-semibold leading-none tracking-tight text-danger">Parking full</p>
        ) : slot ? (
          <p className="text-[44px] font-semibold leading-none tracking-tight">
            Slot <span className="text-accent-green">{slot}</span>
          </p>
        ) : (
          <p className="text-[22px] font-medium text-txt-secondary">{guidance || "—"}</p>
        )}
      </div>
      <p className="mt-4 text-[13px] text-txt-secondary">
        {full ? "All bays are taken. The gate stays closed." : `${freeCount} of 4 bays free.`}
        {!camOnline && <span className="text-danger"> Camera offline, showing last known state.</span>}
      </p>
    </section>
  );
}
