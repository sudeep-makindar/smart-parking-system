// Shapes of the JSON served by the ESP32-S3 (firmware/esp32s3/esp32s3.ino).

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

export interface ParkingStatus {
  zone: string;
  slots: SlotStatus[];
  free_count: number;
  total_slots: number;
  gate_open: boolean;
  cam_online: boolean;
  uptime_s: number;
  guidance: string;
  cam_stream_url: string;
  /** IR sensor currently sees a car at the entry */
  ir_active: boolean;
  /** Number of times the gate opened this session */
  cars_entered: number;
  /** Seconds since the last gate opening, -1 if none yet */
  last_entry_ago_s: number;
  /** Controller clock was set from a browser via POST /api/time */
  time_synced: boolean;
  /** Milliseconds since the last ESP-NOW packet from the camera, -1 if never */
  cam_last_seen_ms: number;
  /** Sequence number of the newest event in /api/events */
  event_seq: number;
  /** Most recent ticket issued at the gate */
  last_ticket: LastTicket | null;
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

export interface ParkingConfig {
  firmware_version: string;
  ap_ssid: string;
  ap_password: string;
  ap_ip: string;
  ap_channel: number;
  ap_clients: number;
  cam_stream_url: string;
  zone: string;
  total_slots: number;
  /** false until the camera has sent its first config packet */
  cam_config_received: boolean;
  pix_thresh: number;
  t_high: number;
  t_low: number;
  calibrated: boolean;
  /** Increments every time the camera finishes a calibration */
  calib_count: number;
  rois: Roi[];
  ref_patch: Roi;
  fee_per_hour: number;
  fee_minimum: number;
  currency: string;
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
  | "calibrated"
  | "settings";

export interface ParkingEvent {
  seq: number;
  /** millis() on the controller when it happened */
  t_ms: number;
  type: EventType;
  slot: string | null;
  /** Score for slot events, ticket id for ticket events, pixel threshold for settings */
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
