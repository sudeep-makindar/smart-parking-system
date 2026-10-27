import GateStatus from "../components/GateStatus";
import GuidancePanel from "../components/GuidancePanel";
import LiveFeed from "../components/LiveFeed";
import SlotGrid from "../components/SlotGrid";
import StatsCard from "../components/StatsCard";
import type { ParkingStatus } from "../types/parking";
import { guidanceSlot } from "../utils/format";

interface Props {
  data: ParkingStatus;
  isConnected: boolean;
}

export default function Overview({ data, isConnected }: Props) {
  const occupied = data.total_slots - data.free_count;
  const full = data.free_count === 0;

  return (
    <div className="space-y-4">
      <div className="panel grid grid-cols-3 divide-x divide-border">
        <StatsCard label="Total slots" value={data.total_slots} hint="Zone A" />
        <StatsCard label="Available" value={data.free_count} tone="free" hint={full ? "None left" : "Ready to park"} />
        <StatsCard
          label="Occupied"
          value={occupied}
          tone={full ? "occupied" : "default"}
          hint={`${Math.round((occupied / data.total_slots) * 100)}% utilised`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <SlotGrid
            slots={data.slots}
            recommendedId={guidanceSlot(data.guidance)}
            stale={!isConnected || !data.cam_online}
          />
        </div>
        <div className="lg:col-span-2">
          <LiveFeed url={data.cam_stream_url} camOnline={data.cam_online} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <GuidancePanel guidance={data.guidance} freeCount={data.free_count} camOnline={data.cam_online} />
        <GateStatus
          gateOpen={data.gate_open}
          irActive={data.ir_active}
          lastEntryAgoS={data.last_entry_ago_s}
          carsEntered={data.cars_entered}
        />
      </div>
    </div>
  );
}
