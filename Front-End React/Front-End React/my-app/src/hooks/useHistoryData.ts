import { useEffect, useRef, useState } from "react";
import type { Point } from "../pages/User/userchart/types";
import { createHttp } from "../pages/User/userchart/lib/http";
import { mapPoints } from "../pages/User/userchart/utils/mapPoints";

function normalizeSerial(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase();
}

function isCanceledError(e: any) {
  return (
    e?.name === "CanceledError" ||
    e?.name === "AbortError" ||
    e?.code === "ERR_CANCELED"
  );
}

function toNumberOrNull(value: any): number | null {
  if (value === undefined || value === null || value === "") return null;

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isValidTemperature(value: any) {
  const n = toNumberOrNull(value);

  if (n === null) return false;

  // Chặn sentinel/rác từ backend/Mongo:
  // -1.7976931348623157e+308 hoặc các giá trị phi thực tế.
  return n > -100 && n < 100;
}

function pointTime(p: Point): number {
  const anyPoint = p as any;

  if (typeof anyPoint.timestamp === "number" && Number.isFinite(anyPoint.timestamp)) {
    return anyPoint.timestamp;
  }

  const raw =
    anyPoint.dateUtc ??
    anyPoint.timeUtc ??
    anyPoint.time ??
    anyPoint.label;

  if (raw instanceof Date && Number.isFinite(raw.getTime())) {
    return raw.getTime();
  }

  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw < 10_000_000_000 ? raw * 1000 : raw;
  }

  if (typeof raw === "string" && raw.trim()) {
    const d = new Date(raw);
    if (Number.isFinite(d.getTime())) return d.getTime();
  }

  return 0;
}

function maxPointsByHours(hours: number) {
  if (hours <= 1) return 360;
  if (hours <= 6) return 720;
  if (hours <= 24) return 1500;
  if (hours <= 24 * 7) return 2500;
  return 3500;
}

function compactPoints(points: Point[], maxPoints: number) {
  if (points.length <= maxPoints) return points;

  const result: Point[] = [];
  const step = Math.ceil(points.length / maxPoints);

  for (let i = 0; i < points.length; i += step) {
    result.push(points[i]);
  }

  const last = points[points.length - 1];
  if (last && result[result.length - 1] !== last) {
    result.push(last);
  }

  return result;
}

function cleanPoints(points: Point[], histHours: number) {
  const maxPoints = maxPointsByHours(histHours);

  const cleaned = points
    .filter((p) => {
      const temp = (p as any).temperature;
      const hum = (p as any).humidity;

      const hasValidTemp = isValidTemperature(temp);
      const hasValidHum = Number.isFinite(Number(hum));

      return hasValidTemp || hasValidHum;
    })
    .sort((a, b) => pointTime(a) - pointTime(b));

  return compactPoints(cleaned, maxPoints);
}

export function useHistoryData(
  selected: string | null,
  histHours: number,
  liveMode: boolean
) {
  const [histData, setHistData] = useState<Point[]>([]);
  const [loading, setLoading] = useState(false);

  const histAbortRef = useRef<AbortController | null>(null);
  const httpRef = useRef(createHttp());

  useEffect(() => {
    const serial = normalizeSerial(selected);
    const hours = Number.isFinite(histHours)
      ? Math.max(1, Math.min(histHours, 24 * 62))
      : 24;

    if (!serial || liveMode) {
      histAbortRef.current?.abort();
      histAbortRef.current = null;
      setHistData([]);
      setLoading(false);
      return;
    }

    histAbortRef.current?.abort();

    const ctrl = new AbortController();
    histAbortRef.current = ctrl;

    const run = async () => {
      setLoading(true);

      try {
        const to = new Date();
        const from = new Date(to.getTime() - hours * 60 * 60 * 1000);

        const data = await httpRef.current.dedupGet<any[]>(
          "/api/sensordata/query-raw",
          {
            serialNumber: serial,
            from: from.toISOString(),
            to: to.toISOString(),
          },
          ctrl.signal
        );

        if (ctrl.signal.aborted) return;

        const mapped = mapPoints(Array.isArray(data) ? data : []);
        const cleaned = cleanPoints(mapped, hours);

        setHistData(cleaned);
      } catch (e: any) {
        if (!ctrl.signal.aborted && !isCanceledError(e)) {
          console.error("[useHistoryData] load failed", e);
          setHistData([]);
        }
      } finally {
        if (!ctrl.signal.aborted) {
          setLoading(false);
        }
      }
    };

    run();

    return () => {
      ctrl.abort();
    };
  }, [selected, histHours, liveMode]);

  return { histData, loading };
}