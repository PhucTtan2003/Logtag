import type { LiveWindow } from "../types";

export const getCurrentRangeUtc = (liveMode: boolean, liveWindow: LiveWindow, histHours: number) => {
  const to = new Date();
  const from = liveMode
    ? new Date(
        to.getTime() -
          (liveWindow === "1h" ? 1 :
           liveWindow === "6h" ? 6 :
           liveWindow === "24h" ? 24 : 24 * 7) *
          60 * 60 * 1000
      )
    : new Date(to.getTime() - histHours * 60 * 60 * 1000);
  return { fromUtc: from.toISOString(), toUtc: to.toISOString() };
};