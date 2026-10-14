// src/api/logtag.ts
import api from "./axios";

//
// ===== Types =====
export type ProfileAlarm = {
  isUpper: boolean;
  thresholdValue?: number | null;
  numberOfReadingsBeforeAlert: number;
  alarmTriggerType?: "Consecutive" | "Accumulative" | "Instant" | string;
  sensor?: "Temperature" | "Humidity" | "Lux" | "Shock" | string;
};

export type TeamProfile = {
  id: number;
  name: string;
  model: string;
  recordingIntervalInSeconds: number;
  startDelayInSeconds: number;
  alarmIndicatorEnabled?: boolean | null;
  allowLoggingStop?: boolean | null;
  alarms: ProfileAlarm[];
};

export type ProfilesEnvelope = {
  data: TeamProfile[];
  status?: string;
  timestampUtc?: string;
};

//
// ===== API =====
/**
 * Lấy danh sách profiles của team.
 * @param teamId ID team
 * @param signal AbortSignal (tuỳ chọn) để huỷ request khi unmount/chuyển trang
 */
export async function fetchProfiles(
  teamId: number,
  signal?: AbortSignal
): Promise<ProfilesEnvelope> {
  try {
    const { data } = await api.get<ProfilesEnvelope>(
      `/api/external/profiles/v1/${teamId}`,
      { signal }
    );
    return data;
  } catch (err: any) {
    // Ném lỗi có ngữ cảnh để chỗ gọi hiển thị thân thiện hơn
    const status = err?.response?.status;
    const msg = err?.message || "Request error";
    throw new Error(
      `[fetchProfiles] teamId=${teamId} ${
        status ? `(HTTP ${status}) ` : ""
      }${msg}`
    );
  }
}
