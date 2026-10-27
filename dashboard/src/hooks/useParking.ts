import { useEffect, useMemo, useRef } from "react";
import { cameraStreamUrl, getCameraStatus, getStatus, syncTime } from "../api/parking";
import type { CameraStatus, ControllerStatus, ParkingStatus, SlotStatus } from "../types/parking";
import { useNodes } from "./useNodes";
import { usePolling, type Polled } from "./usePolling";

const POLL_MS = 1000;

export interface ParkingState {
  data: ParkingStatus | null;
  /** At least one node answered the last poll */
  isConnected: boolean;
  error: string | null;
  lastUpdated: Date | null;
  latencyMs: number | null;
  successRate: number;
  camera: Polled<CameraStatus>;
  controller: Polled<ControllerStatus>;
}

const OFFLINE_CONTROLLER: Omit<ControllerStatus, "slots" | "leds" | "free_count" | "total_slots" | "guidance" | "zone"> = {
  node: "controller",
  name: "",
  firmware: "",
  ip: "",
  rssi: 0,
  cam_online: false,
  cam_last_seen_ms: -1,
  gate_open: false,
  gate_mode: "auto",
  servo_angle: 0,
  ir_active: false,
  buzzer_on: false,
  uptime_s: 0,
  cars_entered: 0,
  cars_denied: 0,
  last_entry_ago_s: -1,
  time_synced: false,
  event_seq: 0,
  last_ticket: null,
};

/**
 * Builds the page model from the primary camera and controller nodes. Slot
 * states come straight from the camera node when it answers (the controller
 * receives the same array over ESP-NOW and adds durations, gate and tickets).
 */
function combine(cam: CameraStatus | null, camLive: boolean, ctrl: ControllerStatus | null, ctrlLive: boolean, camHost: string): ParkingStatus | null {
  if (!cam && !ctrl) return null;
  const useCam = cam && (camLive || !ctrl);
  const zone = cam?.zone ?? ctrl?.zone ?? "A";
  const slots: SlotStatus[] = useCam
    ? cam!.slots.map((occ, i) => {
        const fromCtrl = ctrl?.slots[i];
        const occupied = occ === 1;
        return {
          id: `${zone}${i + 1}`,
          occupied,
          score: cam!.scores[i] ?? 0,
          since: occupied && fromCtrl?.occupied ? fromCtrl.since : 0,
          occupied_for_s: occupied && fromCtrl?.occupied ? fromCtrl.occupied_for_s : 0,
        };
      })
    : ctrl!.slots;
  const free = slots.filter((s) => !s.occupied).length;
  const firstFree = slots.find((s) => !s.occupied);

  return {
    ...OFFLINE_CONTROLLER,
    ...(ctrl ?? {}),
    zone,
    slots,
    leds: ctrl?.leds ?? { slots: slots.map((s) => !s.occupied), pass: false, stop: true },
    free_count: free,
    total_slots: slots.length,
    guidance: firstFree ? `Go to Slot ${firstFree.id}` : "Parking Full",
    cam_online: camLive || Boolean(ctrl?.cam_online),
    cam_stream_url: cam && camHost ? cameraStreamUrl(camHost, cam.stream_port) : "",
    camera: cam,
    sources: { camera: camLive, controller: ctrlLive },
  } as ParkingStatus;
}

/** Polls the primary camera and controller nodes every second. */
export function useParking(): ParkingState {
  const { camera: camNode, controller: ctrlNode } = useNodes();
  const camHost = camNode?.host.trim() ?? "";
  const ctrlHost = ctrlNode?.host.trim() ?? "";

  const camera = usePolling(camHost, () => getCameraStatus(camHost), POLL_MS);
  const controller = usePolling(ctrlHost, () => getStatus(ctrlHost), POLL_MS);

  // Give the controller our clock once so its timestamps are real dates
  const synced = useRef("");
  useEffect(() => {
    if (controller.data && !controller.data.time_synced && synced.current !== ctrlHost) {
      synced.current = ctrlHost;
      syncTime(ctrlHost).catch(() => (synced.current = ""));
    }
  }, [controller.data, ctrlHost]);

  const data = useMemo(
    () => combine(camera.data, camera.isConnected, controller.data, controller.isConnected, camHost),
    [camera.data, camera.isConnected, controller.data, controller.isConnected, camHost],
  );

  const live = [camera, controller].filter((p) => p.isConnected);
  return {
    data,
    isConnected: live.length > 0,
    error: camera.error && controller.error ? `${camera.error} / ${controller.error}` : null,
    lastUpdated: controller.lastUpdated ?? camera.lastUpdated,
    latencyMs: live.length ? Math.max(...live.map((p) => p.latencyMs ?? 0)) : null,
    successRate: Math.min(camera.successRate || 1, controller.successRate || 1) * (live.length ? 1 : 0),
    camera,
    controller,
  };
}
