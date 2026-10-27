import { useState } from "react";
import { USE_MOCK, streamUrl } from "../api/parking";
import type { ParkingConfig, ParkingStatus, StreamMode } from "../types/parking";
import MockCamera from "./MockCamera";
import StreamImage from "./StreamImage";

const MODES: { id: StreamMode; label: string }[] = [
  { id: "raw", label: "Raw" },
  { id: "diff", label: "Difference" },
  { id: "mask", label: "Mask" },
];

interface Props {
  data: ParkingStatus;
  config: ParkingConfig | null;
}

/** Camera stream with switchable detector stages and live per-bay overlays. */
export default function VisionView({ data, config }: Props) {
  const [mode, setMode] = useState<StreamMode>("raw");
  const [overlay, setOverlay] = useState(true);
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const rois = config?.cam_config_received ? config.rois : [];
  const pix = config?.pix_thresh ?? 35;

  const explain: Record<StreamMode, string> = {
    raw: "Grayscale 320×240 frame from the OV3660, as captured.",
    diff: "|frame − empty reference| after a 5×5 blur and brightness correction, brightened ×3.",
    mask: `White where the difference exceeds ${pix}. A bay's score is the share of white pixels inside its box.`,
  };

  return (
    <section className="panel">
      <div className="panel-head flex-wrap">
        <div className="flex rounded-lg border border-border p-0.5" role="tablist" aria-label="Detector stage">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={mode === m.id}
              onClick={() => setMode(m.id)}
              className={`rounded-md px-3 py-1 text-[12px] font-medium transition-colors ${
                mode === m.id ? "bg-white/10 text-txt-primary" : "text-txt-secondary hover:text-txt-primary"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer select-none items-center gap-2 text-[12px] text-txt-secondary">
          <input
            type="checkbox"
            checked={overlay}
            onChange={(e) => setOverlay(e.target.checked)}
            className="h-3.5 w-3.5 accent-white"
          />
          Bay overlay
        </label>
      </div>

      <div className="p-4">
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[10px] bg-black">
          {USE_MOCK ? (
            <MockCamera mode={mode} />
          ) : (
            <StreamImage
              src={streamUrl(data.cam_stream_url, mode)}
              alt="Live parking camera"
              enabled={data.cam_online}
              fallback={(failed) => (
                <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center">
                  <p className="text-[13px] font-medium text-txt-secondary">Camera offline</p>
                  <p className="max-w-[280px] text-[12px] text-txt-muted">
                    {failed ? "Stream unreachable. Only one viewer at a time; retrying." : "No data from the ESP32-CAM."}
                  </p>
                </div>
              )}
            />
          )}

          {overlay && (
            <div className="pointer-events-none absolute inset-0">
              {rois.map((r) => {
                const slot = data.slots.find((s) => s.id === r.id);
                const occ = slot?.occupied ?? false;
                return (
                  <div
                    key={r.id}
                    className={`absolute border-2 transition-colors duration-500 ${occ ? "border-danger" : "border-accent-green"}`}
                    style={{ left: pct(r.x, 320), top: pct(r.y, 240), width: pct(r.w, 320), height: pct(r.h, 240) }}
                  >
                    <span
                      className={`absolute -top-[2px] left-[-2px] -translate-y-full whitespace-nowrap rounded-t-[4px] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-black transition-colors duration-500 ${
                        occ ? "bg-danger" : "bg-accent-green"
                      }`}
                    >
                      {r.id} {slot?.score ?? 0}%
                    </span>
                    <div className="absolute inset-x-1.5 bottom-1.5 h-1 rounded-full bg-black/60">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${occ ? "bg-danger" : "bg-accent-green"}`}
                        style={{ width: `${Math.min(100, slot?.score ?? 0)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              {config?.cam_config_received && (
                <div
                  className="absolute border border-dashed border-white/40"
                  style={{
                    left: pct(config.ref_patch.x, 320),
                    top: pct(config.ref_patch.y, 240),
                    width: pct(config.ref_patch.w, 320),
                    height: pct(config.ref_patch.h, 240),
                  }}
                >
                  <span className="absolute left-1 top-0.5 font-mono text-[10px] text-white/60">REF</span>
                </div>
              )}
            </div>
          )}
        </div>
        <p className="mt-3 text-[12px] text-txt-secondary">{explain[mode]}</p>
      </div>
    </section>
  );
}
