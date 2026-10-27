import { useState } from "react";
import { calibrate, getCameraConfig } from "../api/parking";

type Phase = "idle" | "calibrating" | "done" | "error";

const WAIT_MS = 15000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Props {
  /** Camera node address */
  host: string;
  camOnline: boolean;
  /** Called after the camera confirms a new reference frame */
  onDone?: () => void;
}

export default function CalibrationButton({ host, camOnline, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");

  const run = async () => {
    setPhase("calibrating");
    try {
      const before = (await getCameraConfig(host)).calib_count;
      const res = await calibrate(host);
      if (!res.ok) throw new Error(res.error ?? "Controller rejected the request");

      // The camera reports an incremented calib_count once the reference is saved
      const deadline = Date.now() + WAIT_MS;
      while (Date.now() < deadline) {
        await sleep(1000);
        const cfg = await getCameraConfig(host).catch(() => null);
        if (cfg && cfg.calib_count !== before) {
          setPhase("done");
          onDone?.();
          setTimeout(() => setPhase((p) => (p === "done" ? "idle" : p)), 6000);
          return;
        }
      }
      throw new Error("Camera did not confirm calibration in time");
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-4">
      <button type="button" className="btn-secondary" onClick={run} disabled={phase === "calibrating" || !camOnline}>
        {phase === "calibrating" && (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-txt-muted border-t-txt-primary" />
        )}
        {phase === "calibrating" ? "Calibrating…" : "Recalibrate camera"}
      </button>
      <span className="text-[12px]" role="status">
        {phase === "calibrating" && <span className="text-txt-secondary">Capturing 10 frames of the empty lot…</span>}
        {phase === "done" && <span className="font-medium text-accent-green">✓ Done! New reference saved.</span>}
        {phase === "error" && <span className="text-danger">{error}</span>}
        {phase === "idle" && !camOnline && <span className="text-danger">Camera is offline</span>}
      </span>
    </div>
  );
}
