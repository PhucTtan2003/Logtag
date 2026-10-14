// src/hooks/useSensorChartDataRange.ts
import { useEffect, useRef, useState, useCallback } from "react";
import { getWithRetry } from "../utils/http";
import { singleFlight } from "../utils/singleFlight";

export type DataPoint = {
    time: string | number | Date; label: string; temperature: number; humidity: number; ts?: number 
};

const fmtLocal = (dt: Date) =>
  dt.toLocaleString([], {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

const getUserIdHeader = () => {
  const uid = localStorage.getItem("accountId") || localStorage.getItem("uid") || "";
  return uid ? { "X-User-Id": uid } : {};
};

/** Tải dữ liệu biểu đồ theo khoảng (raw points, không group) */
export function useSensorChartDataRange(
  serial: string,
  fromIsoUtc: string,
  toIsoUtc: string,
  enabled: boolean = true
) {
  const [data, setData] = useState<DataPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    if (!enabled || !serial || !fromIsoUtc || !toIsoUtc) {
      setData([]);
      return;
    }

    if (new Date(fromIsoUtc) > new Date(toIsoUtc)) {
      setError("Khoảng thời gian không hợp lệ (Từ > Đến).");
      setData([]);
      return;
    }

    // Hủy request trước (nếu còn)
    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setError(null);

    const url = "/api/sensordata/query-raw";
    const params = { serialNumber: serial, from: fromIsoUtc, to: toIsoUtc };
    const sfKey = `${url}|${serial}|${fromIsoUtc}|${toIsoUtc}`;

    try {
      const res = await singleFlight(sfKey, async () =>
        getWithRetry(url, { params, signal: ac.signal, headers: { ...getUserIdHeader() } })
      );

      const list = Array.isArray(res.data) ? res.data : [];
      const mapped: DataPoint[] = list.map((r: any) => {
        const iso = r.label || r.dateUtc || r.DateUtc || r.date;
        const dt = new Date(iso);
        const ts = dt.getTime();
        return {
          time: isNaN(ts) ? iso : ts,
          label: isNaN(ts) ? String(iso) : fmtLocal(dt),
          temperature: Number(r.temperature ?? r.Temperature ?? 0),
          humidity: Number(r.humidity ?? r.Humidity ?? 0),
          ts: isNaN(ts) ? undefined : ts,
        };
      });

      setData(mapped);
    } catch (e: any) {
      // Bỏ qua lỗi hủy từ AbortController / axios
      const isCanceled =
        e?.name === "CanceledError" ||
        e?.message === "canceled" ||
        e?.code === "ERR_CANCELED" ||
        e?.name === "AbortError";
      if (!isCanceled) {
        setError("Lỗi tải dữ liệu biểu đồ!");
        setData([]);
      }
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setLoading(false);
    }
  }, [enabled, serial, fromIsoUtc, toIsoUtc]);

  // Gọi fetch khi input đổi
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Hủy khi unmount
  useEffect(
    () => () => {
      if (abortRef.current) abortRef.current.abort();
    },
    []
  );

  return { data, loading, error, refetch: fetchData };
}