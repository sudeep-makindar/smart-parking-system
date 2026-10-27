import type {
  ApiResult,
  CameraConfig,
  CameraStatus,
  ControllerStatus,
  EventsResponse,
  GateMode,
  ParkingHistory,
  StreamMode,
  ThresholdSettings,
  Ticket,
  TicketsResponse,
} from "../types/parking";
import { mockApi } from "./mock";

/** Simulated nodes: `npm run dev:mock`, or append `?mock` to the page URL. */
export const USE_MOCK: boolean =
  import.meta.env.VITE_MOCK === "1" ||
  (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("mock"));

const TIMEOUT_MS = 3000;

/** "192.168.43.12" -> "http://192.168.43.12"; keeps an explicit scheme or port. */
export function nodeBase(host: string): string {
  const h = host.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(h) ? h : `http://${h}`;
}

async function request<T>(host: string, path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${nodeBase(host)}${path}`, { cache: "no-store", ...init, signal: controller.signal });
    const body = (await res.json().catch(() => null)) as T | ApiResult | null;
    if (!res.ok) throw new Error((body as ApiResult | null)?.error ?? `HTTP ${res.status}`);
    if (body === null) throw new Error("Invalid JSON from node");
    return body as T;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw new Error("Node did not respond");
    if (err instanceof TypeError) throw new Error("Node unreachable");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// POST bodies are sent as text/plain so the browser treats them as "simple"
// requests and skips the CORS preflight; the firmware parses the JSON anyway.
function post<T>(host: string, path: string, body?: unknown): Promise<T> {
  return request<T>(host, path, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: body === undefined ? "" : JSON.stringify(body),
  });
}

// ── Camera node ─────────────────────────────────────────────────────
export function getCameraStatus(host: string): Promise<CameraStatus> {
  return USE_MOCK ? mockApi.cameraStatus() : request<CameraStatus>(host, "/api/status");
}

export function getCameraConfig(host: string): Promise<CameraConfig> {
  return USE_MOCK ? mockApi.cameraConfig() : request<CameraConfig>(host, "/api/config");
}

export function calibrate(host: string): Promise<ApiResult> {
  return USE_MOCK ? mockApi.calibrate() : post<ApiResult>(host, "/api/calibrate");
}

export function updateSettings(host: string, settings: ThresholdSettings): Promise<ApiResult> {
  return USE_MOCK ? mockApi.updateSettings(settings) : post<ApiResult>(host, "/api/settings", settings);
}

/** MJPEG URL of a camera node; the stream server listens on its own port. */
export function cameraStreamUrl(host: string, port = 81): string {
  if (!host) return "";
  const base = new URL(nodeBase(host));
  base.port = String(port);
  return `${base.origin}/stream`;
}

/** Stream URL for a debug view; overlay=0 because the dashboard draws its own boxes. */
export function streamUrl(base: string, mode: StreamMode, overlay = false): string {
  if (!base) return "";
  return `${base}${base.includes("?") ? "&" : "?"}mode=${mode}&overlay=${overlay ? 1 : 0}`;
}

// ── Controller node ─────────────────────────────────────────────────
export function getStatus(host: string): Promise<ControllerStatus> {
  return USE_MOCK ? mockApi.controllerStatus() : request<ControllerStatus>(host, "/api/status");
}

export function getHistory(host: string): Promise<ParkingHistory> {
  return USE_MOCK ? mockApi.getHistory() : request<ParkingHistory>(host, "/api/history");
}

export function getEvents(host: string, since: number): Promise<EventsResponse> {
  return USE_MOCK ? mockApi.getEvents(since) : request<EventsResponse>(host, `/api/events?since=${since}`);
}

export function getTickets(host: string): Promise<TicketsResponse> {
  return USE_MOCK ? mockApi.getTickets() : request<TicketsResponse>(host, "/api/tickets");
}

export function getTicket(host: string, id: number): Promise<Ticket> {
  return USE_MOCK ? mockApi.getTicket(id) : request<Ticket>(host, `/api/ticket?id=${id}`);
}

export function setGateMode(host: string, mode: GateMode): Promise<ApiResult> {
  return USE_MOCK ? mockApi.setGateMode(mode) : post<ApiResult>(host, "/api/gate", { mode });
}

export function testBuzzer(host: string, pattern: "beep" | "double" | "long" = "beep"): Promise<ApiResult> {
  return USE_MOCK ? mockApi.buzzer() : post<ApiResult>(host, "/api/buzzer", { pattern });
}

/** The controller has no RTC; give it the browser's clock so timestamps are real. */
export function syncTime(host: string): Promise<ApiResult> {
  const epoch = Math.floor(Date.now() / 1000);
  return USE_MOCK ? Promise.resolve({ ok: true }) : post<ApiResult>(host, "/api/time", { epoch });
}

/** Link that opens a ticket on a phone; carries the controller address so any device can load it. */
export function ticketUrl(id: number, controllerHost: string): string {
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}#/ticket/${id}?node=${encodeURIComponent(controllerHost)}`;
}

export function formatMoney(amount: number, currency: string): string {
  return currency === "INR" ? `₹${amount}` : `${amount} ${currency}`;
}
