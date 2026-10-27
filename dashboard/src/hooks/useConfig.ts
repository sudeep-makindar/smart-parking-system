import { useCallback, useEffect, useState } from "react";
import { getConfig } from "../api/parking";
import type { ParkingConfig } from "../types/parking";

/** Fetches GET /api/config (static info + thresholds + ROIs reported by the camera). */
export function useConfig() {
  const [config, setConfig] = useState<ParkingConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      getConfig()
        .then((c) => {
          setConfig(c);
          setError(null);
          return c;
        })
        .catch((err: Error) => {
          setError(err.message);
          return null;
        }),
    [],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  return { config, error, reload };
}
