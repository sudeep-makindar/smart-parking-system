import { USE_MOCK } from "../api/parking";
import MockCamera from "./MockCamera";
import StreamImage from "./StreamImage";

interface Props {
  url: string;
  camOnline: boolean;
}

/** Overview camera panel (raw stream with the camera's own bay boxes). */
export default function LiveFeed({ url, camOnline }: Props) {
  const live = USE_MOCK || camOnline;
  return (
    <section className="panel flex h-full flex-col">
      <div className="panel-head">
        <h2 className="panel-title">Camera</h2>
        {live ? (
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-danger">
            <span className="dot animate-blink bg-danger" /> Live
          </span>
        ) : (
          <span className="label">Offline</span>
        )}
      </div>
      <div className="flex flex-1 flex-col justify-center p-4">
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[10px] bg-black">
          {USE_MOCK ? (
            <MockCamera mode="raw" />
          ) : (
            <StreamImage
              src={url}
              alt="Live parking camera"
              enabled={camOnline}
              fallback={(failed) => (
                <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center">
                  <p className="text-[13px] font-medium text-txt-secondary">Camera offline</p>
                  <p className="max-w-[260px] text-[12px] text-txt-muted">
                    {!camOnline
                      ? "No data from the ESP32-CAM for 3 seconds."
                      : failed
                        ? "Stream unreachable. Only one viewer can watch at a time; retrying."
                        : "Waiting for stream…"}
                  </p>
                </div>
              )}
            />
          )}
        </div>
      </div>
      <p className="truncate border-t border-border px-5 py-2.5 font-mono text-[11px] text-txt-muted" title={url}>
        {USE_MOCK ? "simulated camera" : url || "—"}
      </p>
    </section>
  );
}
