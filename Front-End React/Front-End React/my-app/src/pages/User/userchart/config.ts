import type { LiveWindow } from "../../../types/liveWindow";
import { capByWindow } from "../../../types/liveWindow";

export const API_BASE = (process.env.REACT_APP_API_BASE_URL || "").replace(/\/$/, "");
export const HUB_PATH = "/hub/logtag";

// Re-export type và constant
export type { LiveWindow };
export { capByWindow };

export const RECONNECTED_FLAG = "__userchart_onreconnected_installed";