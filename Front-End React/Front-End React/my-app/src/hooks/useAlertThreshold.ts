import { useEffect, useState } from "react";
import api from "../api/axios";

export function useAlertThreshold(serial?: string) {
  const [thresholds, setThresholds] = useState<
    { min?: number | null; max?: number | null } | undefined
  >(undefined);

  useEffect(() => {
    if (!serial) return;

    api
      .get(`api/alert-thresholds/${serial}`)
      .then((res) => setThresholds(res.data))
      .catch(() => setThresholds(undefined));
  }, [serial]);

  return thresholds;
}
