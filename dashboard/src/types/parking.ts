// Shapes of the JSON served by the nodes (firmware/esp32cam and firmware/esp32).

export interface SlotStatus {
  id: string;
  occupied: boolean;
  /** Detection score 0–100 (changed-pixel ratio × 100) */
  score: number;
  /** Epoch seconds when the slot became occupied (uptime seconds if the clock is not synced), 0 if free */
  since: number;
  /** Seconds the slot has been occupied, 0 if free */
  occupied_for_s: number;
}

export type GateMode = "auto" | "open" | "closed";
export type NodeKind = "camera" | "controller";

/** A device the dashboard talks to, configured in Settings > Nodes. */
export interface NodeConfig {
  id: string;
  name: string;
  kind: NodeKind;
  /** IP or hostname, e.g. "192.168.43.12" or "parking-cam.local" */
  host: string;
}

/** GET /api/status on a camera node (ESP32-CAM). */
export interface CameraStatus {
  node: "camera";
  name: string;
  firmware: string;
  zone: string;
  /** 1 = occupied, 0 = free, one entry per slot */
  slots: number[];
  scores: number[];
  seq: number;
  uptime_s: number;
  calibrated: boolean;
  calibrating: boolean;
  calib_count: number;
  ip: string;
  rssi: number;
  stream_port: number;
}

/** GET /api/status on a controller node (ESP32). */
export interface ControllerStatus {
  node: "controller";
  name: string;
  firmware: string;
  ip: string;
  rssi: number;
  zone: string;
  slots: SlotStatus[];
  leds: { slots: boolean[]; pass: boolean; stop: boolean };
  free_count: number;
  total_slots: number;
  guidance: string;
  /** Controller still receives ESP-NOW packets from the camera */
  cam_online: boolean;
  /** Milliseconds since the last ESP-NOW packet from the camera, -1 if never */
  cam_last_seen_ms: number;
  gate_open: boolean;
  gate_mode: GateMode;
  servo_angle: number;
  /** IR sensor currently sees a car at the entry */
  ir_active: boolean;
  buzzer_on: boolean;
  uptime_s: number;
  /** Cars let in this session */
  cars_entered: number;
  /** Cars refused (lot full or gate closed) */
  cars_denied: number;
  /** Seconds since the last car entered, -1 if none yet */
  last_entry_ago_s: number;
  /** Controller clock was set from a browser via POST /api/time */
  time_synced: boolean;
  /** Sequence number of the newest event in /api/events */
  event_seq: number;
  /** Most recent ticket issued at the gate */
  last_ticket: LastTicket | null;
}

/**
 * What the pages render: the controller's state with the slot array taken
 * directly from the camera node when it is reachable.
 */
export interface ParkingStatus extends ControllerStatus {
  /** MJPEG URL of the primary camera node, "" if none */
  cam_stream_url: string;
  camera: CameraStatus | null;
  /** Which nodes answered the last poll */
  sources: { camera: boolean; controller: boolean };
}

export interface LastTicket {
  id: number;
  bay: string | null;
  entry_ago_s: number;
}

export interface SlotHistory {
  id: string;
  total_occupied_s: number;
  change_count: number;
}

export interface ParkingHistory {
  session_start: number;
  uptime_s: number;
  slots: SlotHistory[];
}

export interface Roi {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** GET /api/config on a camera node. */
export interface CameraConfig {
  node: "camera";
  firmware: string;
  zone: string;
  total_slots: number;
  frame_w: number;
  frame_h: number;
  pix_thresh: number;
  t_high: number;
  t_low: number;
  calibrated: boolean;
  /** Increments every time the camera finishes a calibration */
  calib_count: number;
  rois: Roi[];
  ref_patch: Roi;
}

export interface ThresholdSettings {
  pix_thresh: number;
  t_high: number;
  t_low: number;
}

export interface ApiResult {
  ok: boolean;
  error?: string;
}

export type EventType =
  | "slot_occupied"
  | "slot_free"
  | "gate_open"
  | "gate_close"
  | "entry_denied"
  | "ticket_issued"
  | "ticket_closed"
  | "cam_online"
  | "cam_offline"
  | "gate_mode";

export interface ParkingEvent {
  seq: number;
  /** millis() on the controller when it happened */
  t_ms: number;
  type: EventType;
  slot: string | null;
  /** Score for slot events, ticket id for ticket events, mode (0 auto, 1 open, 2 closed) for gate_mode, reason (0 full, 1 gate closed) for entry_denied */
  value: number;
}

export interface EventsResponse {
  seq: number;
  uptime_ms: number;
  events: ParkingEvent[];
}

export type TicketState = "entered" | "parked" | "closed";

export interface Ticket {
  id: number;
  state: TicketState;
  /** Bay suggested at the gate */
  assigned_bay: string | null;
  /** Bay the car actually parked in */
  bay: string | null;
  entry_ago_s: number;
  duration_s: number;
  /** Final fee when closed, running fee otherwise */
  fee: number;
  currency: string;
}

export interface TicketsResponse {
  issued: number;
  fee_per_hour: number;
  fee_minimum: number;
  currency: string;
  tickets: Ticket[];
}

export type StreamMode = "raw" | "diff" | "mask";
