import { useEffect, useRef, useState } from "react";
import type { HubConnection } from "@microsoft/signalr";
import type { LiveWindow, Point } from "../pages/User/userchart/types";
import {
  API_BASE,
  HUB_PATH,
  capByWindow,
  RECONNECTED_FLAG,
} from "../pages/User/userchart/config";
import { mapPoints } from "../pages/User/userchart/utils/mapPoints";
import { fmtLocal } from "../pages/User/userchart/utils/time";
import { createHttp } from "../pages/User/userchart/lib/http";
import { getLogTagConnection, ensureStarted } from "../realtime/logtaghub";

type ThresholdLive = {
  upperThreshold: number | null;
  lowerThreshold: number | null;
};

function normalizeSerial(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase();
}

function stripChannelSuffix(value: string | null | undefined) {
  const serial = normalizeSerial(value);
  return serial.replace(/-CH\d+$/i, "");
}

function isSameSerial(a: string | null | undefined, b: string | null | undefined) {
  const aa = normalizeSerial(a);
  const bb = normalizeSerial(b);

  if (!aa || !bb) return false;
  if (aa === bb) return true;

  return stripChannelSuffix(aa) === stripChannelSuffix(bb);
}

function buildHubUrl() {
  const base = String(API_BASE || "").replace(/\/+$/, "");
  const path = String(HUB_PATH || "/hub/logtag");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

async function joinSerialGroup(conn: HubConnection, serialRaw: string) {
  const serial = normalizeSerial(serialRaw);
  if (!serial) return;

  const room = `serial:${serial}`;

  const tryInvoke = async (method: string, arg: string) => {
    try {
      await conn.invoke(method, arg);
      return true;
    } catch {
      return false;
    }
  };

  // Backend hiện tại dùng JoinSerial.
  if (await tryInvoke("JoinSerial", serial)) return;

  // Fallback nếu sau này đổi tên method Hub.
  if (await tryInvoke("JoinGroup", room)) return;
  if (await tryInvoke("Join", room)) return;
}

async function leaveSerialGroup(conn: HubConnection, serialRaw: string) {
  const serial = normalizeSerial(serialRaw);
  if (!serial) return;

  const room = `serial:${serial}`;

  const tryInvoke = async (method: string, arg: string) => {
    try {
      await conn.invoke(method, arg);
      return true;
    } catch {
      return false;
    }
  };

  if (await tryInvoke("LeaveSerial", serial)) return;
  if (await tryInvoke("LeaveGroup", room)) return;
  if (await tryInvoke("Leave", room)) return;
}

function readMessageSerial(msg: any) {
  return normalizeSerial(
    msg?.SerialNumber ??
      msg?.serialNumber ??
      msg?.DeviceId ??
      msg?.deviceId ??
      msg?.Serial ??
      msg?.serial
  );
}

function readMessageDate(msg: any) {
  const raw =
    msg?.DateUtc ??
    msg?.dateUtc ??
    msg?.TimeUtc ??
    msg?.timeUtc ??
    msg?.TimestampUtc ??
    msg?.timestampUtc ??
    msg?.timestamp ??
    msg?.createdAt ??
    msg?.createAt ??
    msg?.label;

  if (raw instanceof Date && Number.isFinite(raw.getTime())) return raw;

  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Backend có thể gửi Unix seconds hoặc milliseconds.
    return new Date(raw < 10_000_000_000 ? raw * 1000 : raw);
  }

  if (typeof raw === "string" && raw.trim()) {
    const d = new Date(raw);
    if (Number.isFinite(d.getTime())) return d;
  }

  // Không để mất điểm realtime nếu payload thiếu thời gian.
  return new Date();
}

function toNumber(value: any, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toNullableNumber(value: any): number | null {
  if (value === null || value === undefined || value === "") return null;

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function hasUsableReading(msg: any) {
  const t = msg?.Temperature ?? msg?.temperature;
  const h = msg?.Humidity ?? msg?.humidity;
  return Number.isFinite(Number(t)) || Number.isFinite(Number(h));
}

function pointTime(p: Point): number {
  const anyPoint = p as any;

  if (typeof anyPoint.timestamp === "number" && Number.isFinite(anyPoint.timestamp)) {
    return anyPoint.timestamp;
  }

  const raw = anyPoint.dateUtc ?? anyPoint.timeUtc ?? anyPoint.time ?? anyPoint.label;

  if (raw instanceof Date && Number.isFinite(raw.getTime())) return raw.getTime();

  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw < 10_000_000_000 ? raw * 1000 : raw;
  }

  if (typeof raw === "string" && raw.trim()) {
    const d = new Date(raw);
    if (Number.isFinite(d.getTime())) return d.getTime();
  }

  return 0;
}

function normalizePoint(p: Point): Point {
  const ts = pointTime(p);

  return {
    ...p,
    timestamp: ts > 0 ? ts : Date.now(),
  } as Point;
}

function messageToPoint(msg: any): Point {
  const d = readMessageDate(msg);
  const ts = d.getTime();

  return {
    label: fmtLocal(d),
    temperature: toNumber(msg?.Temperature ?? msg?.temperature),
    humidity: toNumber(msg?.Humidity ?? msg?.humidity),
    timestamp: ts,
  } as Point;
}

function mergePoints(prev: Point[], incoming: Point[], liveWindow: LiveWindow) {
  const cap = capByWindow[liveWindow] ?? 1000;
  const map = new Map<string, Point>();

  for (const p of [...prev, ...incoming]) {
    const normalized = normalizePoint(p);
    const ts = pointTime(normalized);

    // Chống trùng theo timestamp. Nếu timestamp lỗi thì dùng label.
    const key = ts > 0 ? String(ts) : String((normalized as any).label ?? Math.random());
    map.set(key, normalized);
  }

  return Array.from(map.values())
    .sort((a, b) => pointTime(a) - pointTime(b))
    .slice(-cap);
}

/**
 * Hook realtime cho UserChartPage.
 *
 * Mục tiêu:
 * - Seed chart từ MongoDB: /api/sensordata/GetRecent
 * - Bắt ReadingUpdate để append điểm realtime thật.
 * - Bắt ReceiveStatusUpdate để dùng latest status làm điểm tạm cho chart.
 * - Bắt ReceiveAlert để hết warning "No client method receivealert" và refresh nhẹ DB.
 * - Bắt window event "alert-threshold-updated" để chart đổi Max/Min ngay sau khi lưu ngưỡng.
 * - Đăng ký handler TRƯỚC ensureStarted để không miss seed Hub lúc mới connect.
 * - Fallback polling 30s để bù khi tab sleep hoặc SignalR miss event.
 */
export function useLiveReadings(
  selected: string | null,
  liveWindow: LiveWindow,
  liveMode: boolean
) {
  const [liveData, setLiveData] = useState<Point[]>([]);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [liveUnavailable, setLiveUnavailable] = useState(false);

  // Ngưỡng realtime sau khi lưu ở modal cài ngưỡng.
  const [thresholdLive, setThresholdLive] = useState<ThresholdLive | null>(null);

  const currentSnRef = useRef<string>("");
  const connRef = useRef<HubConnection | null>(null);
  const joinedSnRef = useRef<string>("");
  const batchRef = useRef<Point[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const alertRefreshTimerRef = useRef<number | null>(null);
  const seedAbortRef = useRef<AbortController | null>(null);

  /**
   * Nhận event sau khi bấm "Lưu ngưỡng" ở component cài ngưỡng.
   *
   * Bên file lưu ngưỡng cần dispatch như này:
   *
   * window.dispatchEvent(
   *   new CustomEvent("alert-threshold-updated", {
   *     detail: {
   *       serialNumber: serial,
   *       upperThreshold: nextUpper,
   *       lowerThreshold: nextLower,
   *     },
   *   })
   * );
   */
  useEffect(() => {
    const serial = normalizeSerial(selected);

    // Đổi thiết bị thì bỏ ngưỡng live cũ để tránh lấy nhầm.
    setThresholdLive(null);

    if (!serial) return;

    const onThresholdUpdated = (event: Event) => {
      const custom = event as CustomEvent<{
        serialNumber?: string;
        SerialNumber?: string;
        serial?: string;
        Serial?: string;
        deviceId?: string;
        DeviceId?: string;

        upperThreshold?: number | string | null;
        UpperThreshold?: number | string | null;
        lowerThreshold?: number | string | null;
        LowerThreshold?: number | string | null;

        upper?: number | string | null;
        lower?: number | string | null;
        max?: number | string | null;
        min?: number | string | null;
      }>;

      const detail = custom.detail;
      if (!detail) return;

      const eventSerial = readMessageSerial(detail);
      if (!isSameSerial(eventSerial, serial)) return;

      const nextUpper = toNullableNumber(
        detail.upperThreshold ??
          detail.UpperThreshold ??
          detail.upper ??
          detail.max
      );

      const nextLower = toNullableNumber(
        detail.lowerThreshold ??
          detail.LowerThreshold ??
          detail.lower ??
          detail.min
      );

      setThresholdLive({
        upperThreshold: nextUpper,
        lowerThreshold: nextLower,
      });
    };

    window.addEventListener("alert-threshold-updated", onThresholdUpdated);
    window.addEventListener("AlertThresholdUpdated", onThresholdUpdated as EventListener);

    return () => {
      window.removeEventListener("alert-threshold-updated", onThresholdUpdated);
      window.removeEventListener("AlertThresholdUpdated", onThresholdUpdated as EventListener);
    };
  }, [selected]);

  useEffect(() => {
    const serial = normalizeSerial(selected);

    if (!serial || !liveMode) {
      if (flushTimerRef.current) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      if (refreshTimerRef.current) {
        window.clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      if (alertRefreshTimerRef.current) {
        window.clearTimeout(alertRefreshTimerRef.current);
        alertRefreshTimerRef.current = null;
      }
      if (seedAbortRef.current) {
        seedAbortRef.current.abort();
        seedAbortRef.current = null;
      }

      const conn = connRef.current || ((window as any).__logtag_conn as HubConnection | undefined);
      const joined = joinedSnRef.current;
      if (conn && joined) {
        leaveSerialGroup(conn, joined).catch(() => {});
      }

      currentSnRef.current = "";
      joinedSnRef.current = "";
      batchRef.current = [];
      setLatencyMs(null);
      setLiveUnavailable(false);
      return;
    }

    let disposed = false;
    currentSnRef.current = serial;

    const scheduleFlush = () => {
      if (flushTimerRef.current != null) return;

      flushTimerRef.current = window.setTimeout(() => {
        const pending = batchRef.current;
        batchRef.current = [];
        flushTimerRef.current = null;

        if (!pending.length || disposed) return;
        setLiveData((prev) => mergePoints(prev, pending, liveWindow));
      }, 180);
    };

    const fetchSeed = async (soft = false) => {
      if (seedAbortRef.current) seedAbortRef.current.abort();

      const ctrl = new AbortController();
      seedAbortRef.current = ctrl;

      if (!soft) setLoading(true);

      try {
        const cap = capByWindow[liveWindow] ?? 1000;
        const data = await createHttp().dedupGet<any[]>(
          "/api/sensordata/GetRecent",
          { serialNumber: serial, window: liveWindow, n: cap },
          ctrl.signal
        );

        if (disposed || ctrl.signal.aborted) return;

        const seed = mapPoints(Array.isArray(data) ? data : [])
          .map(normalizePoint)
          .slice(-cap);

        setLiveData((prev) => (soft ? mergePoints(prev, seed, liveWindow) : seed));
      } catch (e: any) {
        if (e?.name !== "AbortError" && e?.name !== "CanceledError" && !soft) {
          setLiveUnavailable(true);
        }
      } finally {
        if (!disposed && !soft) setLoading(false);
      }
    };

    const requestSoftRefresh = () => {
      if (alertRefreshTimerRef.current != null) return;

      alertRefreshTimerRef.current = window.setTimeout(() => {
        alertRefreshTimerRef.current = null;
        fetchSeed(true).catch(() => {});
      }, 1200);
    };

    const onReading = (payload: any) => {
      const messages = Array.isArray(payload) ? payload : [payload];

      for (const msg of messages) {
        if (!msg) continue;

        const msgSerial = readMessageSerial(msg);
        if (!msgSerial || msgSerial !== currentSnRef.current) continue;
        if (!hasUsableReading(msg)) continue;

        const point = messageToPoint(msg);
        const ts = pointTime(point);

        if (ts > 0) setLatencyMs(Math.max(0, Date.now() - ts));
        batchRef.current.push(point);
      }

      if (batchRef.current.length) scheduleFlush();
    };

    const onStatusUpdate = (payload: any) => {
      // Realtime-status dùng event này. Nếu có Temperature/Humidity thì cho vào chart như điểm tạm.
      onReading(payload);
    };

    const onAlert = (payload: any) => {
      // Alert không phải reading, nhưng giúp biết Hub còn sống.
      // Sau alert đúng serial thì refresh nhẹ DB để lấy reading mới nếu có.
      const messages = Array.isArray(payload) ? payload : [payload];
      const related = messages.some((msg) => readMessageSerial(msg) === currentSnRef.current);
      if (related) requestSoftRefresh();
    };

    const attachHandlers = (conn: HubConnection) => {
      // Đăng ký trước khi start để bắt được seed OnConnectedAsync của backend.
      try { conn.off("ReadingUpdate", onReading as any); } catch {}
      try { conn.off("ReceiveStatusUpdate", onStatusUpdate as any); } catch {}
      try { conn.off("ReceiveAlert", onAlert as any); } catch {}

      // Một số log SignalR hiển thị method lowercase; thêm alias để an toàn.
      try { conn.off("readingupdate", onReading as any); } catch {}
      try { conn.off("receivestatusupdate", onStatusUpdate as any); } catch {}
      try { conn.off("receivealert", onAlert as any); } catch {}

      conn.on("ReadingUpdate", onReading);
      conn.on("ReceiveStatusUpdate", onStatusUpdate);
      conn.on("ReceiveAlert", onAlert);

      conn.on("readingupdate", onReading);
      conn.on("receivestatusupdate", onStatusUpdate);
      conn.on("receivealert", onAlert);
    };

    const detachHandlers = (conn: HubConnection) => {
      try { conn.off("ReadingUpdate", onReading as any); } catch {}
      try { conn.off("ReceiveStatusUpdate", onStatusUpdate as any); } catch {}
      try { conn.off("ReceiveAlert", onAlert as any); } catch {}
      try { conn.off("readingupdate", onReading as any); } catch {}
      try { conn.off("receivestatusupdate", onStatusUpdate as any); } catch {}
      try { conn.off("receivealert", onAlert as any); } catch {}
    };

    const startFallbackPolling = () => {
      if (refreshTimerRef.current) window.clearInterval(refreshTimerRef.current);

      refreshTimerRef.current = window.setInterval(() => {
        fetchSeed(true).catch(() => {});
      }, 30_000);
    };

    const startRealtime = async () => {
      const hubUrl = buildHubUrl();
      const conn = getLogTagConnection(
        hubUrl,
        () => localStorage.getItem("accountId") || localStorage.getItem("uid") || ""
      );

      connRef.current = conn;
      (window as any).__logtag_conn = conn;

      attachHandlers(conn);

      const hubStartedPromise = ensureStarted(conn)
        .then(() => true)
        .catch(() => false);

      // Start Hub + seed DB song song để chart hiện nhanh.
      await Promise.all([hubStartedPromise, fetchSeed(false)]);

      if (disposed) return;

      const hubStarted = await hubStartedPromise;
      startFallbackPolling();

      if (!hubStarted) {
        setLiveUnavailable(true);
        return;
      }

      if (!(conn as any)[RECONNECTED_FLAG]) {
        conn.onreconnected(async () => {
          try {
            const sn = currentSnRef.current;
            if (sn) {
              await joinSerialGroup(conn, sn);
              joinedSnRef.current = sn;
              fetchSeed(true).catch(() => {});
            }
          } catch {
            // ignore
          }
        });
        (conn as any)[RECONNECTED_FLAG] = true;
      }

      const previousJoined = joinedSnRef.current;
      if (previousJoined && previousJoined !== serial) {
        await leaveSerialGroup(conn, previousJoined).catch(() => {});
      }

      await joinSerialGroup(conn, serial);
      joinedSnRef.current = serial;

      if (!disposed) setLiveUnavailable(false);
    };

    startRealtime().catch(() => {
      if (!disposed) {
        setLiveUnavailable(true);
        setLoading(false);
        startFallbackPolling();
      }
    });

    return () => {
      disposed = true;

      if (flushTimerRef.current) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }

      if (refreshTimerRef.current) {
        window.clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }

      if (alertRefreshTimerRef.current) {
        window.clearTimeout(alertRefreshTimerRef.current);
        alertRefreshTimerRef.current = null;
      }

      if (seedAbortRef.current) {
        seedAbortRef.current.abort();
        seedAbortRef.current = null;
      }

      batchRef.current = [];

      const conn = connRef.current || ((window as any).__logtag_conn as HubConnection | undefined);
      if (conn) {
        detachHandlers(conn);
        leaveSerialGroup(conn, serial).catch(() => {});
      }

      if (currentSnRef.current === serial) currentSnRef.current = "";
      if (joinedSnRef.current === serial) joinedSnRef.current = "";
    };
  }, [selected, liveMode, liveWindow]);

  return {
    liveData,
    latencyMs,
    loading,
    liveUnavailable,
    thresholdLive,
  };
}
