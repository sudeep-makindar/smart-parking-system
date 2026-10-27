import { useEffect, useState } from "react";

export default function LiveClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <time dateTime={now.toISOString()} className="num font-mono text-[12px] text-txt-secondary">
      {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
    </time>
  );
}
