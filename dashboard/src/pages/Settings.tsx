import { useEffect, useState } from "react";
import { updateSettings } from "../api/parking";
import CalibrationButton from "../components/CalibrationButton";
import SystemInfo from "../components/SystemInfo";
import ThresholdSlider from "../components/ThresholdSlider";
import { useConfig } from "../hooks/useConfig";
import type { ParkingConfig, ParkingStatus, ThresholdSettings } from "../types/parking";

const DEFAULTS: ThresholdSettings = { pix_thresh: 35, t_high: 0.3, t_low: 0.15 };

interface Props {
  data: ParkingStatus;
}

export default function Settings({ data }: Props) {
  const { config, error: configError, reload } = useConfig();
  const [values, setValues] = useState<ThresholdSettings>(DEFAULTS);
  const [loadedFromCam, setLoadedFromCam] = useState(false);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");

  // Start the sliders at whatever the camera is actually using
  useEffect(() => {
    if (config?.cam_config_received && !loadedFromCam) {
      setValues({ pix_thresh: config.pix_thresh, t_high: config.t_high, t_low: config.t_low });
      setLoadedFromCam(true);
    }
  }, [config, loadedFromCam]);

  const invalid = values.t_low >= values.t_high;
  const set = (k: keyof ThresholdSettings) => (v: number) => {
    setValues((prev) => ({ ...prev, [k]: v }));
    setSaving("idle");
  };

  const apply = async () => {
    setSaving("saving");
    try {
      const res = await updateSettings({
        pix_thresh: Math.round(values.pix_thresh),
        t_high: Number(values.t_high.toFixed(2)),
        t_low: Number(values.t_low.toFixed(2)),
      });
      if (!res.ok) throw new Error(res.error ?? "Rejected");
      setSaving("saved");
      setTimeout(reload, 1500);
    } catch (err) {
      setSaving("error");
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  };

  const fmt2 = (v: number) => v.toFixed(2);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Detection thresholds</h2>
              <p className="mt-0.5 text-[12px] text-txt-secondary">
                {loadedFromCam ? "Current values from the ESP32-CAM." : "Waiting for the camera; showing defaults."}
              </p>
            </div>
          </div>

          <div className="divide-y divide-border px-5">
            <ThresholdSlider
              label="Pixel threshold"
              description="Minimum brightness difference for a pixel to count as changed. Lower it for dark cars on a dark mat."
              min={10}
              max={80}
              step={1}
              value={values.pix_thresh}
              defaultValue={DEFAULTS.pix_thresh}
              onChange={set("pix_thresh")}
            />
            <ThresholdSlider
              label="Occupied threshold (T_HIGH)"
              description="A bay becomes occupied when its changed-pixel ratio rises above this."
              min={0.1}
              max={0.6}
              step={0.01}
              value={values.t_high}
              defaultValue={DEFAULTS.t_high}
              onChange={set("t_high")}
              format={fmt2}
            />
            <ThresholdSlider
              label="Empty threshold (T_LOW)"
              description="A bay becomes empty when its ratio drops below this. Must be lower than T_HIGH."
              min={0.05}
              max={0.4}
              step={0.01}
              value={values.t_low}
              defaultValue={DEFAULTS.t_low}
              onChange={set("t_low")}
              format={fmt2}
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-4 border-t border-border px-5 py-3.5">
            <span className="mr-auto text-[12px]" role="status">
              {invalid && <span className="text-danger">T_LOW must be lower than T_HIGH.</span>}
              {!invalid && saving === "saved" && <span className="text-accent-green">✓ Sent to camera</span>}
              {!invalid && saving === "error" && <span className="text-danger">{saveError}</span>}
            </span>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setValues(DEFAULTS);
                setSaving("idle");
              }}
            >
              Reset
            </button>
            <button type="button" className="btn-primary" onClick={apply} disabled={invalid || saving === "saving"}>
              {saving === "saving" ? "Applying…" : "Apply"}
            </button>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title">Calibration</h2>
            {config && (
              <span className="text-[12px] text-txt-secondary">
                {config.calibrated ? `Reference saved · ${config.calib_count}× this boot` : "Not calibrated"}
              </span>
            )}
          </div>
          <div className="space-y-4 px-5 py-5">
            <p className="text-[13px] leading-relaxed text-txt-secondary">
              <span className="font-medium text-amber-300">Ensure all slots are empty before calibrating.</span> The
              camera averages 10 frames into a new empty reference. Anything parked now is treated as background.
            </p>
            <CalibrationButton camOnline={data.cam_online} onDone={reload} />
          </div>
        </section>
      </div>

      <div className="space-y-4">
        <SystemInfo
          title="Device"
          items={[
            { label: "Controller IP", value: config?.ap_ip ?? "192.168.4.1", mono: true },
            { label: "Stream URL", value: config?.cam_stream_url ?? data.cam_stream_url, mono: true },
            { label: "Wi-Fi SSID", value: config?.ap_ssid ?? "—", mono: true },
            { label: "Wi-Fi password", value: config?.ap_password ?? "—", mono: true },
            { label: "Channel", value: config?.ap_channel ?? "—" },
            { label: "Connected devices", value: config?.ap_clients ?? "—" },
            { label: "Firmware", value: config?.firmware_version ?? "—", mono: true },
          ]}
        >
          {configError && <p className="px-5 pb-4 text-[12px] text-danger">Could not load /api/config: {configError}</p>}
        </SystemInfo>

        <SystemInfo
          title="Zone"
          action={<span className="text-[12px] text-txt-secondary">Read-only</span>}
          items={[
            { label: "Zone ID", value: config?.zone ?? data.zone },
            { label: "Slots", value: config?.total_slots ?? data.total_slots },
          ]}
        >
          <div className="border-t border-border px-5 py-4">
            {config?.cam_config_received ? <RoiTable config={config} /> : (
              <p className="text-[12px] text-txt-secondary">Waiting for the camera to report its ROIs…</p>
            )}
          </div>
        </SystemInfo>
      </div>
    </div>
  );
}

function RoiTable({ config }: { config: ParkingConfig }) {
  const rows = [...config.rois, config.ref_patch];
  return (
    <>
      <p className="label mb-3">Regions of interest · 320×240</p>
      <svg viewBox="0 0 320 240" className="w-full rounded-lg border border-border bg-black">
        {config.rois.map((r) => (
          <g key={r.id}>
            <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke="#e5e5e5" strokeWidth="1.5" />
            <text x={r.x + 5} y={r.y + 15} fill="#e5e5e5" fontSize="11" fontFamily="ui-monospace, monospace">
              {r.id}
            </text>
          </g>
        ))}
        <rect
          x={config.ref_patch.x}
          y={config.ref_patch.y}
          width={config.ref_patch.w}
          height={config.ref_patch.h}
          fill="none"
          stroke="#666"
          strokeDasharray="4 3"
        />
        <text x={config.ref_patch.x + 4} y={config.ref_patch.y + 13} fill="#777" fontSize="10" fontFamily="ui-monospace, monospace">
          REF
        </text>
      </svg>
      <table className="mt-3 w-full font-mono text-[12px]">
        <thead>
          <tr className="text-left text-txt-muted">
            {["", "x", "y", "w", "h"].map((h) => (
              <th key={h} className="py-1 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-txt-secondary">
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className="py-1.5 font-semibold text-txt-primary">{r.id}</td>
              <td>{r.x}</td>
              <td>{r.y}</td>
              <td>{r.w}</td>
              <td>{r.h}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[11px] text-txt-muted">
        REF is the always-empty patch used for brightness correction. Edit ROIs in esp32cam.ino.
      </p>
    </>
  );
}
