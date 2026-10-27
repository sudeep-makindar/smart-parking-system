import { useMemo } from "react";
import qrcode from "qrcode-generator";

interface Props {
  value: string;
  size?: number;
  className?: string;
}

/** QR code rendered as a single SVG path (dark modules on white, 2-module quiet zone). */
export default function TicketQR({ value, size = 160, className = "" }: Props) {
  const { path, n } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < count; r++)
      for (let c = 0; c < count; c++) if (qr.isDark(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`;
    return { path: d, n: count + 4 };
  }, [value]);

  return (
    <svg
      viewBox={`0 0 ${n} ${n}`}
      width={size}
      height={size}
      className={`rounded-lg bg-white ${className}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`QR code for ${value}`}
    >
      <path d={path} fill="#0d0d0d" />
    </svg>
  );
}
