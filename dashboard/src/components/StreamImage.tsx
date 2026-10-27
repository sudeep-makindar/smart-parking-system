import { useEffect, useRef, useState } from "react";

interface Props {
  src: string;
  alt: string;
  /** Rendered while there is no stream (offline, failed, retrying) */
  fallback: (failed: boolean) => React.ReactNode;
  enabled: boolean;
}

const RETRY_MS = 5000;
// 1×1 transparent GIF; assigning it aborts the open MJPEG connection
const BLANK = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

/**
 * MJPEG <img> that retries when the stream breaks and always closes its
 * connection on unmount; the ESP32-CAM serves one stream client at a time.
 */
export default function StreamImage({ src, alt, fallback, enabled }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const show = enabled && Boolean(src) && !failed;

  useEffect(() => {
    if (!failed) return;
    const id = setTimeout(() => {
      setFailed(false);
      setAttempt((n) => n + 1);
    }, RETRY_MS);
    return () => clearTimeout(id);
  }, [failed]);

  useEffect(() => {
    const img = imgRef.current;
    return () => {
      if (img) img.src = BLANK;
    };
  }, [show, attempt, src]);

  if (!show) return <>{fallback(failed)}</>;
  return (
    <img
      ref={imgRef}
      src={`${src}${src.includes("?") ? "&" : "?"}t=${attempt}`}
      alt={alt}
      className="h-full w-full object-contain"
      onError={() => setFailed(true)}
    />
  );
}
