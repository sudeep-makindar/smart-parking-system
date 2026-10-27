// In-browser simulation of the ESP32-S3 API so the dashboard can be explored
// without any hardware. Enabled with `npm run dev:mock` or `?mock` in the URL.
//
// It mirrors the firmware: cars arrive at the gate, get a ticket, park
// (usually in the suggested bay), leave and pay. The first 12 minutes are
// fast-forwarded on load so the timeline has history immediately.
import type {
  ApiResult,
  EventType,
  EventsResponse,
  ParkingConfig,
  ParkingEvent,
  ParkingHistory,
  ParkingStatus,
  Roi,
  ThresholdSettings,
  Ticket,
  TicketState,
  TicketsResponse,
} from "../types/parking";

const FEE_PER_HOUR = 20;
const FEE_MINIMUM = 10;
const HISTORY_MS = 12 * 60 * 1000;

export const MOCK_ROIS: Roi[] = [
  { id: "A1", x: 14, y: 56, w: 66, h: 112 },
  { id: "A2", x: 92, y: 56, w: 66, h: 112 },
  { id: "A3", x: 170, y: 56, w: 66, h: 112 },
  { id: "A4", x: 248, y: 56, w: 66, h: 112 },
];
export const MOCK_REF: Roi = { id: "REF", x: 130, y: 196, w: 60, h: 28 };

interface SimSlot {
  id: string;
  occupied: boolean;
  score: number;
  sinceMs: number;
  totalMs: number;
  changes: number;
}

interface SimTicket {
  id: number;
  state: TicketState;
  assigned: number;
  slot: number;
  entryMs: number;
  exitMs: number;
  fee: number;
}

type Action = { at: number; run: (now: number) => void };

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const bootMs = Date.now() - HISTORY_MS;
const slots: SimSlot[] = ["A1", "A2", "A3", "A4"].map((id) => ({
  id,
  occupied: false,
  score: 4,
  sinceMs: 0,
  totalMs: 0,
  changes: 0,
}));
const events: ParkingEvent[] = [];
const tickets: SimTicket[] = [];
let queue: Action[] = [];
const settings: ThresholdSettings = { pix_thresh: 35, t_high: 0.3, t_low: 0.15 };
let calibCount = 1;
let gateOpen = false;
let irActive = false;
let carsEntered = 0;
let lastEntryMs = 0;
let nextArrival = bootMs + 5000;
let lastTick = bootMs;

const fee = (ms: number) => Math.max(FEE_MINIMUM, Math.ceil((Math.ceil(ms / 60000) * FEE_PER_HOUR) / 60));
const firstFree = () => slots.findIndex((s) => !s.occupied);

function log(at: number, type: EventType, slot: number, value = 0) {
  events.push({ seq: events.length + 1, t_ms: at - bootMs, type, slot: slot >= 0 ? slots[slot].id : null, value });
}

function setSlot(i: number, occ: boolean, at: number) {
  const s = slots[i];
  if (s.occupied === occ) return;
  if (s.occupied) s.totalMs += at - s.sinceMs;
  s.occupied = occ;
  s.sinceMs = occ ? at : 0;
  s.changes++;
  s.score = occ ? Math.round(rand(55, 75)) : Math.round(rand(2, 8));
  log(at, occ ? "slot_occupied" : "slot_free", i, s.score);

  if (occ) {
    const t = tickets.find((x) => x.state === "entered" && x.assigned === i) ?? tickets.find((x) => x.state === "entered");
    if (t) {
      t.state = "parked";
      t.slot = i;
    }
  } else {
    const t = tickets.find((x) => x.state === "parked" && x.slot === i);
    if (t) {
      t.state = "closed";
      t.exitMs = at;
      t.fee = fee(at - t.entryMs);
      log(at, "ticket_closed", i, t.id);
    }
  }
}

function arrive(at: number) {
  irActive = true;
  const free = firstFree();
  if (free < 0) {
    log(at, "entry_denied", -1);
    queue.push({ at: at + 2500, run: () => (irActive = false) });
    return;
  }
  gateOpen = true;
  carsEntered++;
  lastEntryMs = at;
  log(at, "gate_open", -1);
  const t: SimTicket = { id: 1001 + tickets.length, state: "entered", assigned: free, slot: -1, entryMs: at, exitMs: 0, fee: 0 };
  tickets.push(t);
  log(at, "ticket_issued", free, t.id);

  // Usually parks where it was told to; sometimes picks another free bay
  const bay = () => {
    const freeBays = slots.map((s, i) => (!s.occupied ? i : -1)).filter((i) => i >= 0);
    if (!freeBays.length) return -1;
    return freeBays.includes(free) && Math.random() < 0.85 ? free : freeBays[Math.floor(Math.random() * freeBays.length)];
  };
  queue.push({ at: at + 2500, run: () => (irActive = false) });
  queue.push({ at: at + 7500, run: (now) => { gateOpen = false; log(now, "gate_close", -1); } });
  queue.push({
    at: at + rand(9000, 14000),
    run: (now) => {
      const i = bay();
      if (i < 0) return;
      setSlot(i, true, now);
      queue.push({ at: now + rand(40_000, 150_000), run: (later) => setSlot(i, false, later) });
    },
  });
}

function tick(now: number) {
  for (let t = lastTick; t <= now; t += 1000) {
    if (t >= nextArrival) {
      arrive(t);
      nextArrival = t + rand(25_000, 70_000);
    }
    const due = queue.filter((a) => a.at <= t);
    queue = queue.filter((a) => a.at > t);
    due.forEach((a) => a.run(t));
  }
  lastTick = now;
  for (const s of slots) {
    const target = s.occupied ? 66 : 5;
    s.score = Math.max(0, Math.min(100, Math.round(s.score + (target - s.score) * 0.3 + rand(-3, 3))));
  }
}

// Fast-forward through the pre-history
log(bootMs + 1200, "cam_online", -1);
tick(Date.now());

const delay = <T>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), rand(30, 140)));

function toTicket(t: SimTicket, now: number): Ticket {
  const end = t.state === "closed" ? t.exitMs : now;
  return {
    id: t.id,
    state: t.state,
    assigned_bay: slots[t.assigned]?.id ?? null,
    bay: t.slot >= 0 ? slots[t.slot].id : null,
    entry_ago_s: Math.floor((now - t.entryMs) / 1000),
    duration_s: Math.floor((end - t.entryMs) / 1000),
    fee: t.state === "closed" ? t.fee : fee(end - t.entryMs),
    currency: "INR",
  };
}

export const mockApi = {
  getStatus(): Promise<ParkingStatus> {
    const now = Date.now();
    tick(now);
    const free = firstFree();
    const last = tickets[tickets.length - 1];
    return delay({
      zone: "A",
      slots: slots.map((s) => ({
        id: s.id,
        occupied: s.occupied,
        score: s.score,
        since: s.occupied ? Math.floor(s.sinceMs / 1000) : 0,
        occupied_for_s: s.occupied ? Math.floor((now - s.sinceMs) / 1000) : 0,
      })),
      free_count: slots.filter((s) => !s.occupied).length,
      total_slots: slots.length,
      gate_open: gateOpen,
      cam_online: true,
      uptime_s: Math.floor((now - bootMs) / 1000),
      guidance: free >= 0 ? `Go to Slot ${slots[free].id}` : "Parking Full",
      cam_stream_url: "",
      ir_active: irActive,
      cars_entered: carsEntered,
      last_entry_ago_s: lastEntryMs ? Math.floor((now - lastEntryMs) / 1000) : -1,
      time_synced: true,
      cam_last_seen_ms: Math.round(rand(20, 480)),
      event_seq: events.length,
      last_ticket: last
        ? { id: last.id, bay: slots[last.assigned]?.id ?? null, entry_ago_s: Math.floor((now - last.entryMs) / 1000) }
        : null,
    });
  },

  getHistory(): Promise<ParkingHistory> {
    const now = Date.now();
    tick(now);
    return delay({
      session_start: Math.floor(bootMs / 1000),
      uptime_s: Math.floor((now - bootMs) / 1000),
      slots: slots.map((s) => ({
        id: s.id,
        total_occupied_s: Math.floor((s.totalMs + (s.occupied ? now - s.sinceMs : 0)) / 1000),
        change_count: s.changes,
      })),
    });
  },

  getEvents(since: number): Promise<EventsResponse> {
    const now = Date.now();
    tick(now);
    return delay({ seq: events.length, uptime_ms: now - bootMs, events: events.filter((e) => e.seq > since) });
  },

  getTickets(): Promise<TicketsResponse> {
    const now = Date.now();
    tick(now);
    return delay({
      issued: tickets.length,
      fee_per_hour: FEE_PER_HOUR,
      fee_minimum: FEE_MINIMUM,
      currency: "INR",
      tickets: tickets.slice(-16).reverse().map((t) => toTicket(t, now)),
    });
  },

  getTicket(id: number): Promise<Ticket> {
    const now = Date.now();
    tick(now);
    const t = tickets.find((x) => x.id === id);
    return t ? delay(toTicket(t, now)) : Promise.reject(new Error("Ticket not found"));
  },

  getConfig(): Promise<ParkingConfig> {
    return delay({
      firmware_version: "1.1.0-mock",
      ap_ssid: "SmartParking",
      ap_password: "park1234",
      ap_ip: "192.168.4.1",
      ap_channel: 1,
      ap_clients: 1,
      cam_stream_url: "http://192.168.4.2:81/stream",
      zone: "A",
      total_slots: 4,
      cam_config_received: true,
      ...settings,
      calibrated: true,
      calib_count: calibCount,
      rois: MOCK_ROIS,
      ref_patch: MOCK_REF,
      fee_per_hour: FEE_PER_HOUR,
      fee_minimum: FEE_MINIMUM,
      currency: "INR",
    });
  },

  calibrate(): Promise<ApiResult> {
    setTimeout(() => {
      calibCount++;
      log(Date.now(), "calibrated", -1, calibCount);
    }, 2500);
    return delay({ ok: true });
  },

  updateSettings(next: ThresholdSettings): Promise<ApiResult> {
    Object.assign(settings, next);
    log(Date.now(), "settings", -1, next.pix_thresh);
    return delay({ ok: true });
  },
};

/** Current simulated slot states, for the fake camera image. */
export const mockSlots = () => slots.map((s) => s.occupied);
/** Pixel threshold the simulated detector uses. */
export const mockPixThresh = () => settings.pix_thresh;
