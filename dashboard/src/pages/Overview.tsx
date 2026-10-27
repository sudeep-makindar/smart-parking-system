import GateStatus from "../components/GateStatus";
import HardwarePanel from "../components/HardwarePanel";
import GuidancePanel from "../components/GuidancePanel";
import LiveFeed from "../components/LiveFeed";
import SlotGrid from "../components/SlotGrid";
import StatsCard from "../components/StatsCard";
import type { ParkingStatus } from "../types/parking";
import { useNodes } from "../hooks/useNodes";
import { guidanceSlot } from "../utils/format";

interface Props {
  data: ParkingStatus;
  isConnected: boolean;
}

export default function Overview({ data, isConnected }: Props) {
  const { controller } = useNodes();
  const ctrlHost = controller?.host.trim() ?? "";
  const occupied = data.total_slots - data.free_count;
  const full = data.free_count === 0;

  return (
    <div className="space-y-4">
      <div className="panel grid grid-cols-3 divide-x divide-border">
        <StatsCard label="Total slots" value={data.total_slots} hint={`Zone ${data.zone}`} />
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <GuidancePanel guidance={data.guidance} freeCount={data.free_count} camOnline={data.cam_online} />
        <GateStatus data={data} controllerHost={ctrlHost} />
        <div className="md:col-span-2 xl:col-span-1">
          <HardwarePanel data={data} controllerHost={ctrlHost} />
        </div>
      </div>
    </div>
  );
}
