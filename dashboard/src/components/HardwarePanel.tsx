import { useState } from "react";
import { testBuzzer } from "../api/parking";
import type { ParkingStatus } from "../types/parking";

interface Props {
  data: ParkingStatus;
  controllerHost: string;
}

function Led({ on, color, label }: { on: boolean; color: "orange" | "green" | "red"; label: string }) {
  const lit = { orange: "bg-orange-400 shadow-[0_0_10px_rgba(251,146,60,0.7)]", green: "bg-accent-green shadow-[0_0_10px_rgba(57,255,20,0.6)]", red: "bg-danger shadow-[0_0_10px_rgba(255,59,59,0.6)]" }[color];
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className={`h-4 w-4 rounded-full border border-black/40 transition-all duration-300 ${on ? lit : "bg-[#2a2a2a]"}`} />
      <span className="font-mono text-[10px] text-txt-muted">{label}</span>
    </div>
  );
}

/** Live mirror of the controller node's outputs and inputs. */
export default function HardwarePanel({ data, controllerHost }: Props) {
  const [busy, setBusy] = useState(false);
  const live = data.sources.controller;

  const beep = async () => {
    setBusy(true);
    await testBuzzer(controllerHost).catch(() => undefined);
    setTimeout(() => setBusy(false), 400);
  };

  return (
    <section className="panel flex flex-col p-5">
      <div className="flex items-center justify-between">
        <p className="label">Controller hardware</p>
        <span className={`flex items-center gap-1.5 text-[11px] ${live ? "text-txt-secondary" : "text-danger"}`}>
          <span className={`dot ${live ? "bg-accent-green" : "bg-danger"}`} />
          {live ? data.name || "online" : "offline"}
        </span>
      </div>

      <div className="mt-5">
        <p className="mb-2 text-[12px] text-txt-secondary">Slot LEDs · lit = free</p>
        <div className="flex gap-5">
          {data.slots.map((s, i) => (
            <Led key={s.id} on={data.leds.slots[i] ?? !s.occupied} color="orange" label={s.id} />
          ))}
        </div>
      </div>

      <div className="mt-5 flex gap-5">
        <Led on={data.leds.pass} color="green" label="PASS" />
        <Led on={data.leds.stop} color="red" label="STOP" />
      </div>

      <dl className="mt-auto grid grid-cols-3 border-t border-border pt-4">
        <div>
          <dt className="label">IR sensor</dt>
          <dd className="mt-1.5 flex items-center gap-1.5 text-[13px] font-medium">
            <span className={`dot ${data.ir_active ? "bg-accent-green" : "bg-txt-muted"}`} />
            {data.ir_active ? "Car" : "Clear"}
          </dd>
        </div>
        <div>
          <dt className="label">Servo</dt>
          <dd className="num mt-1.5 text-[13px] font-medium">{data.servo_angle}°</dd>
        </div>
        <div>
          <dt className="label">Buzzer</dt>
          <dd className="mt-1 flex items-center gap-2 text-[13px] font-medium">
            <span className={`dot ${data.buzzer_on ? "animate-blink bg-amber-400" : "bg-txt-muted"}`} />
            <button
              type="button"
              onClick={beep}
              disabled={!live || busy}
              className="rounded-md border border-border px-2 py-0.5 text-[11px] text-txt-secondary hover:text-txt-primary disabled:opacity-40"
            >
              Test
            </button>
          </dd>
        </div>
      </dl>
    </section>
  );
}
