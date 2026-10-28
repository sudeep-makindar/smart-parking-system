import { useEffect, useRef, useState } from "react";
import { ticketUrl } from "../api/parking";
import LiveClock from "../components/LiveClock";
import TicketQR from "../components/TicketQR";
import { useNodes } from "../hooks/useNodes";
import type { ParkingState } from "../hooks/useParking";
import { guidanceSlot } from "../utils/format";

const WELCOME_S = 20;

function readVoicePref(): boolean {
  try {
    return localStorage.getItem("sign-voice") === "1";
  } catch {
    return false;
  }
}

function speak(text: string) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.95;
  window.speechSynthesis.speak(u);
}

// "A2" -> "A 2" so it is read as a bay, not a word
const spoken = (bay: string) => bay.split("").join(" ");

/** Full-screen display for a tablet or monitor at the entrance. */
export default function SignPage({ parking }: { parking: ParkingState }) {
  const { data, isConnected } = parking;
  const { controller } = useNodes();
  const [voice, setVoice] = useState(readVoicePref);
  const prevGate = useRef<boolean | null>(null);
  const prevDenied = useRef(false);

  const ticket = data?.last_ticket;
  const welcome = Boolean(data?.gate_open && ticket && ticket.entry_ago_s < WELCOME_S);
  const full = data ? data.free_count === 0 : false;
  const next = data ? guidanceSlot(data.guidance) : null;

  useEffect(() => {
    if (!data) return;
    if (voice && prevGate.current === false && data.gate_open && ticket?.bay) {
      speak(`Welcome. Please proceed to slot ${spoken(ticket.bay)}. Scan the code for your ticket.`);
    }
    prevGate.current = data.gate_open;

    const denied = data.ir_active && !data.gate_open && (data.free_count === 0 || data.gate_mode === "closed");
    if (voice && denied && !prevDenied.current)
      speak(data.gate_mode === "closed" ? "Sorry, the entrance is closed." : "Sorry, the car park is full. Please wait.");
    prevDenied.current = denied;
  }, [data, voice, ticket]);

  const toggleVoice = () => {
    const on = !voice;
    setVoice(on);
    try {
      localStorage.setItem("sign-voice", on ? "1" : "0");
    } catch {
      /* private mode: preference just isn't remembered */
    }
    if (on) speak("Voice announcements on.");
  };

  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  };

  return (
    <div className="flex min-h-dvh flex-col bg-bg-primary px-6 py-6 sm:px-12 sm:py-10">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-white text-[22px] font-bold text-black">P</span>
          <div className="leading-tight">
            <p className="text-[18px] font-semibold tracking-tight">Parking</p>
            <p className="text-[13px] text-txt-secondary">Zone A · 4 bays</p>
          </div>
        </div>
        <div className="flex items-center gap-4 [&_time]:text-[18px] [&_time]:text-txt-primary">
          {!isConnected && <span className="text-[13px] text-danger">Offline</span>}
          <LiveClock />
        </div>
      </header>

      <main className="flex flex-1 items-center py-10">
        {!data ? (
          <p className="w-full text-center text-[20px] text-txt-secondary">Connecting…</p>
        ) : welcome && ticket ? (
          <div key={`w${ticket.id}`} className="grid w-full animate-fade-in items-center gap-12 md:grid-cols-[1fr_auto]">
            <div>
              <p className="text-[clamp(28px,4vw,48px)] font-medium text-txt-secondary">Welcome</p>
              <p className="mt-2 text-[clamp(20px,2.5vw,30px)] text-txt-secondary">Please proceed to</p>
              <p className="mt-2 flex items-center gap-6 text-[clamp(120px,20vw,260px)] font-semibold leading-[0.9] tracking-tight text-accent-green">
                {ticket.bay}
                <svg viewBox="0 0 24 24" className="h-[0.45em] w-[0.45em]" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M5 12h13M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </p>
            </div>
            <div className="flex flex-col items-center gap-4">
              <TicketQR value={ticketUrl(ticket.id, controller?.host.trim() ?? "")} size={240} className="p-2" />
              <p className="text-center text-[15px] text-txt-secondary">
                Scan for your ticket
                <br />
                <span className="font-mono text-[20px] font-semibold text-txt-primary">#{ticket.id}</span>
              </p>
            </div>
          </div>
        ) : full ? (
          <div key="full" className="w-full animate-fade-in text-center">
            <p className="text-[clamp(120px,22vw,300px)] font-semibold leading-none tracking-tight text-danger">FULL</p>
            <p className="mt-6 text-[clamp(18px,2.4vw,28px)] text-txt-secondary">No spaces available. Please wait.</p>
          </div>
        ) : (
          <div key="free" className="grid w-full animate-fade-in items-end gap-12 md:grid-cols-[1fr_auto]">
            <div>
              <p className="text-[clamp(160px,26vw,340px)] font-semibold leading-[0.85] tracking-tight text-accent-green">
                {data.free_count}
              </p>
              <p className="mt-4 text-[clamp(22px,3vw,40px)] font-medium uppercase tracking-[0.12em] text-txt-secondary">
                {data.free_count === 1 ? "Space free" : "Spaces free"}
              </p>
            </div>
            <div className="space-y-6">
              {next && (
                <p className="text-[clamp(28px,3.5vw,44px)] font-medium">
                  Next <span className="font-semibold text-accent-green">{next}</span> →
                </p>
              )}
              <div className="flex gap-2">
                {data.slots.map((s) => (
                  <div
                    key={s.id}
                    className={`grid h-24 w-16 place-items-center rounded-lg border-2 font-mono text-[18px] font-semibold transition-colors duration-500 ${
                      s.occupied ? "border-danger/60 bg-danger/10 text-danger" : "border-accent-green/60 text-accent-green"
                    }`}
                  >
                    {s.id}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="flex items-center justify-between text-[12px] text-txt-muted">
        <span>Smart Parking System</span>
        <div className="flex gap-2">
          <button type="button" onClick={toggleVoice} className="btn-secondary h-8 px-3 text-[12px]">
            {voice ? "Voice on" : "Enable voice"}
          </button>
          <button type="button" onClick={fullscreen} className="btn-secondary h-8 px-3 text-[12px]">
            Fullscreen
          </button>
        </div>
      </footer>
    </div>
  );
}
