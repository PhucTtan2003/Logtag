// Định nghĩa type LiveWindow cho toàn bộ project
export type LiveWindow = "1h" | "6h" | "24h" | "7d" | "30d" | "62d";

// Bảng giới hạn buffer tương ứng mỗi cửa sổ realtime
export const capByWindow: Record<LiveWindow, number> = {
  "1h": 360,        // 1h  = 360 điểm (mỗi 10s 1 điểm)
  "6h": 2160,       // 6h  = 6 * 360
  "24h": 8640,      // 24h = 24 * 360
  "7d": 60480,      // 7d  = 7 * 24 * 360
  "30d": 259200,    // 30d = 30 * 24 * 360
  "62d": 535680,    // 62d = 62 * 24 * 360
};