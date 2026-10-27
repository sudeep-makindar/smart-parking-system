import { useEffect, useRef } from "react";
import { MOCK_REF, MOCK_ROIS, mockPixThresh, mockSlots } from "../api/mock";
import type { StreamMode } from "../types/parking";

const W = 320;
const H = 240;
const DIFF_GAIN = 3;
const CAR_SHADES = [52, 196, 88, 150];

// Empty lot: asphalt with texture, painted bay lines and the reference patch
function makeReference(): Uint8ClampedArray {
  const img = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const grain = ((x * 7919 + y * 104729) % 23) - 11;
      img[y * W + x] = 96 + y * 0.12 + grain * 0.6;
    }
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) img[y * W + x] = 215;
  };
  for (const r of MOCK_ROIS) {
    line(r.x - 5, r.y - 6, r.x - 3, r.y + r.h + 4);
    line(r.x + r.w + 3, r.y - 6, r.x + r.w + 5, r.y + r.h + 4);
    line(r.x - 5, r.y - 8, r.x + r.w + 5, r.y - 6);
  }
  return img;
}

function drawCar(img: Uint8ClampedArray, i: number) {
  const r = MOCK_ROIS[i];
  const shade = CAR_SHADES[i];
  const x0 = r.x + 8, x1 = r.x + r.w - 8, y0 = r.y + 10, y1 = r.y + r.h - 6;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const corner = (x - x0 < 5 || x1 - x < 5) && (y - y0 < 6 || y1 - y < 6);
      if (corner) continue;
      const glass = (y > y0 + 16 && y < y0 + 30) || (y > y1 - 22 && y < y1 - 12);
      img[y * W + x] = glass ? 30 : shade;
    }
}

interface Props {
  mode: StreamMode;
}

/**
 * Fake camera for demo mode. It runs the same pipeline as the ESP32-CAM:
 * the "frame" is the empty reference plus cars and sensor noise, and the
 * diff/mask views are computed from it exactly like the firmware does.
 */
export default function MockCamera({ mode }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const reference = makeReference();
    const frame = new Uint8ClampedArray(W * H);
    const out = ctx.createImageData(W, H);
    let raf = 0;
    let last = 0;

    const render = (t: number) => {
      raf = requestAnimationFrame(render);
      if (t - last < 110) return;
      last = t;
      frame.set(reference);
      mockSlots().forEach((occ, i) => occ && drawCar(frame, i));
      const thresh = mockPixThresh();
      for (let i = 0; i < W * H; i++) {
        const v = frame[i] + (Math.random() * 14 - 7);
        const d = Math.abs(v - reference[i]);
        const px = mode === "raw" ? v : mode === "diff" ? Math.min(255, d * DIFF_GAIN) : d > thresh ? 255 : 0;
        out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = px;
        out.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
      // reference patch marker for orientation in raw view
      if (mode === "raw") {
        ctx.strokeStyle = "rgba(255,255,255,0.15)";
        ctx.strokeRect(MOCK_REF.x + 0.5, MOCK_REF.y + 0.5, MOCK_REF.w, MOCK_REF.h);
      }
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      className="h-full w-full object-contain [image-rendering:pixelated]"
      aria-label="Simulated camera"
    />
  );
}
