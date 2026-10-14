import type { Point } from "../types";
import { fmtLocal } from "./time";

export const mapPoints = (list: any[]): Point[] => {
  if (!Array.isArray(list)) return [];
  const out: Point[] = new Array(list.length);
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    const iso = r.dateUtc ?? r.DateUtc ?? r.label ?? r.date ?? r.createdAt ?? r.createAt;
    const d = new Date(iso);
    out[i] = {
      timestamp: d,
      label: isNaN(d.getTime()) ? String(iso) : fmtLocal(d),
      temperature: Number(r.temperature ?? r.Temperature ?? 0),
      humidity: Number(r.humidity ?? r.Humidity ?? 0),
    };
  }
  return out;
};