import type {
  ApiResult,
  EventsResponse,
  ParkingConfig,
  ParkingHistory,
  ParkingStatus,
  StreamMode,
  ThresholdSettings,
  Ticket,
  TicketsResponse,
} from "../types/parking";
import { mockApi } from "./mock";

// In production the dashboard is served by the ESP32-S3 itself, so a relative
// URL (same origin) always works. During `npm run dev` it talks to the board
// directly; override with VITE_API_URL in .env.local.
export const API_BASE: string =
  import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://192.168.4.1" : "");

/** Simulated data: `npm run dev:mock`, or append `?mock` to the page URL. */
export const USE_MOCK: boolean =
  import.meta.env.VITE_MOCK === "1" ||
  (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("mock"));

const TIMEOUT_MS = 3000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      cache: "no-store",
      ...init,
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => null)) as T | ApiResult | null;
    if (!res.ok) {
      const msg = (body as ApiResult | null)?.error ?? `HTTP ${res.status}`;
      throw new Error(msg);
    }
    if (body === null) throw new Error("Invalid JSON from controller");
    return body as T;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Controller did not respond");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// POST bodies are sent as text/plain so the browser treats them as "simple"
// requests and skips the CORS preflight; the firmware parses the JSON anyway.
function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: body === undefined ? "" : JSON.stringify(body),
  });
}

export function getStatus(): Promise<ParkingStatus> {
  return USE_MOCK ? mockApi.getStatus() : request<ParkingStatus>("/api/status");
}

export function getHistory(): Promise<ParkingHistory> {
  return USE_MOCK ? mockApi.getHistory() : request<ParkingHistory>("/api/history");
}

export function getConfig(): Promise<ParkingConfig> {
  return USE_MOCK ? mockApi.getConfig() : request<ParkingConfig>("/api/config");
}

export function calibrate(): Promise<ApiResult> {
  return USE_MOCK ? mockApi.calibrate() : post<ApiResult>("/api/calibrate");
}

export function updateSettings(settings: ThresholdSettings): Promise<ApiResult> {
  return USE_MOCK ? mockApi.updateSettings(settings) : post<ApiResult>("/api/settings", settings);
}

export function getEvents(since: number): Promise<EventsResponse> {
  return USE_MOCK ? mockApi.getEvents(since) : request<EventsResponse>(`/api/events?since=${since}`);
}

export function getTickets(): Promise<TicketsResponse> {
  return USE_MOCK ? mockApi.getTickets() : request<TicketsResponse>("/api/tickets");
}

export function getTicket(id: number): Promise<Ticket> {
  return USE_MOCK ? mockApi.getTicket(id) : request<Ticket>(`/api/ticket?id=${id}`);
}

/** Camera stream URL for a debug view; overlay=0 because the dashboard draws its own boxes. */
export function streamUrl(base: string, mode: StreamMode, overlay = false): string {
  if (!base) return "";
  return `${base}${base.includes("?") ? "&" : "?"}mode=${mode}&overlay=${overlay ? 1 : 0}`;
}

/** Link that opens a ticket on a phone (works on the SmartParking Wi-Fi). */
export function ticketUrl(id: number): string {
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}#/ticket/${id}`;
}

export function formatMoney(amount: number, currency: string): string {
  return currency === "INR" ? `₹${amount}` : `${amount} ${currency}`;
}

/** The controller has no RTC; give it the browser's clock so timestamps are real. */
export function syncTime(): Promise<ApiResult> {
  const epoch = Math.floor(Date.now() / 1000);
  return USE_MOCK ? Promise.resolve({ ok: true }) : post<ApiResult>("/api/time", { epoch });
}
