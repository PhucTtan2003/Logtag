import type { Point } from "../types/chart";

const fmtLocal = (d: Date) =>
  d.toLocaleString("vi-VN", {
    hour12: false,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export const mapPoints = (list: any[]): Point[] => {
  if (!Array.isArray(list)) return [];

  return list.map((r) => {
    const rawTime =
      r.timestamp ??
      r.Timestamp ??
      r.time ??
      r.Time ??
      r.dateUtc ??
      r.DateUtc ??
      r.label ??
      r.date ??
      r.createdAt ??
      r.createAt;

    const d = new Date(rawTime);
    const okDate = !Number.isNaN(d.getTime());

    return {
      // ✅ Quan trọng: Point đang yêu cầu timestamp, nên phải trả về timestamp
      timestamp: okDate ? d.getTime() : rawTime,
      label: okDate ? fmtLocal(d) : String(rawTime ?? ""),
      temperature: Number(r.temperature ?? r.Temperature ?? 0),
      humidity: Number(r.humidity ?? r.Humidity ?? 0),
    };
  });
};

export const capByWindow = {
  "1h": 600,
  "6h": 1200,
  "24h": 2400,
  "7d": 4000,
  "30d": 8000,
  "62d": 12000,
} as const;
