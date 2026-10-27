import { useCallback, useEffect, useState } from "react";
import { getCameraConfig } from "../api/parking";
import type { CameraConfig } from "../types/parking";

/** Fetches GET /api/config from a camera node (thresholds, ROIs, calibration). */
export function useConfig(host: string) {
  const [config, setConfig] = useState<CameraConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      host
        ? getCameraConfig(host)
            .then((c) => {
              setConfig(c);
              setError(null);
              return c;
            })
            .catch((err: Error) => {
              setError(err.message);
              return null;
            })
        : Promise.resolve(null),
    [host],
  );

  useEffect(() => {
    setConfig(null);
    reload();
  }, [reload]);

  return { config, error, reload };
}
