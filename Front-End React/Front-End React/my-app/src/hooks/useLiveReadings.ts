// src/hooks/useLiveReadings.ts
import { useCallback, useEffect, useRef, useState } from "react";
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

/**
 * Hook realtime đọc dữ liệu sensor theo thiết bị.
 *
 * Bản fix:
 * - Join serial ngay sau khi SignalR start, tránh case connRef vừa tạo nhưng effect join đã chạy trước đó.
 * - Nghe nhiều tên event phổ biến, nhưng ưu tiên ReadingUpdate từ backend hiện tại.
 * - Realtime append thẳng vào liveData, có timestamp, sort, chống trùng.
 * - Có fallback soft-poll mỗi 30s để chart vẫn tự cập nhật nếu SignalR miss event.
 * - Không clear chart cũ khi seed/fallback lỗi nhẹ, tránh nhấp nháy UI.
 */

const REALTIME_EVENTS = [
  "ReadingUpdate",
  "ReceiveReading",
  "ReceiveLiveReading",
  "LiveReading",
] as const;

const FALLBACK_POLL_MS = 30_000;

/** Chuẩn hoá serial */
function normalizeSerial(serialRaw: string | null | undefined) {
  return String(serialRaw || "").trim().toUpperCase();
}

function buildHubUrl() {
  const base = String(API_BASE || "").replace(/\/+$/, "");
  const path = String(HUB_PATH || "/hub/logtag");
  return base ? `${base}${path}` : path;
}

function pickFirst<T = any>(...values: any[]): T | undefined {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== "") return v as T;
  }
  return undefined;
}

function parseDateMs(raw: any): number | null {
  if (raw === undefined || raw === null || raw === "") return null;

  if (raw instanceof Date) {
    const ms = raw.getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  if (typeof raw === "number") {
    // Hỗ trợ cả Unix seconds và milliseconds
    const ms = raw < 10_000_000_000 ? raw * 1000 : raw;
    return Number.isFinite(ms) ? ms : null;
  }

  const d = new Date(String(raw));
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function toNumberOrNull(raw: any): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function pointKey(p: Point) {
  const anyPoint = p as any;
  const ts = anyPoint.timestamp;
  if (typeof ts === "number" && Number.isFinite(ts)) return `ts:${ts}`;
  return `label:${String(p.label || "")}`;
}

function getPointTimestamp(p: Point): number | null {
  const ts = (p as any).timestamp;
  if (typeof ts === "number" && Number.isFinite(ts)) return ts;

  const fromLabel = parseDateMs((p as any).label);
  return fromLabel;
}

function mergePoints(prev: Point[], incoming: Point[], liveWindow: LiveWindow) {
  const cap = capByWindow[liveWindow] || 1500;
  const map = new Map<string, Point>();

  for (const p of prev) map.set(pointKey(p), p);
  for (const p of incoming) map.set(pointKey(p), p);

  const merged = Array.from(map.values());

  merged.sort((a, b) => {
    const ta = getPointTimestamp(a);
    const tb = getPointTimestamp(b);
    if (ta !== null && tb !== null) return ta - tb;
    return 0;
  });

  return merged.length > cap ? merged.slice(merged.length - cap) : merged;
}

function messageToPoint(msg: any): { serial: string; point: Point; latencyMs: number | null } | null {
  if (!msg) return null;

  const serial = normalizeSerial(
    pickFirst(
      msg.SerialNumber,
      msg.serialNumber,
      msg.Serial,
      msg.serial,
      msg.deviceId,
      msg.DeviceId,
      msg.sn
    )
  );

  if (!serial) return null;

  const rawDate = pickFirst(
    msg.DateUtc,
    msg.dateUtc,
    msg.TimeUtc,
    msg.timeUtc,
    msg.TimestampUtc,
    msg.timestampUtc,
    msg.createdAt,
    msg.createAt,
    msg.time,
    msg.label
  );

  const timestamp = parseDateMs(rawDate) ?? Date.now();
  const label = fmtLocal(new Date(timestamp));

  const temperature = toNumberOrNull(
    pickFirst(msg.Temperature, msg.temperature, msg.temp, msg.Temp)
  );

  const humidity = toNumberOrNull(
    pickFirst(msg.Humidity, msg.humidity, msg.rh, msg.RH)
  );

  // Không append điểm không có cả nhiệt độ lẫn độ ẩm
  if (temperature === null && humidity === null) return null;

  const point: Point = {
    label,
    temperature: temperature ?? 0,
    humidity: humidity ?? 0,
    timestamp,
    isTempAlarm:
      msg.IsTempAlarm === true ||
      msg.isTempAlarm === true ||
      msg.isAlarm === true ||
      msg.alarm === true,
  } as Point;

  return {
    serial,
    point,
    latencyMs: Date.now() - timestamp,
  };
}

/** Tham gia group theo serial */
async function joinSerialGroup(conn: HubConnection, serialRaw: string) {
  const serial = normalizeSerial(serialRaw);
  if (!serial) return false;

  const room = `serial:${serial}`;

  const tryInvoke = async (method: string, arg: any) => {
    try {
      await conn.invoke(method, arg);
      return true;
    } catch {
      return false;
    }
  };

  if (await tryInvoke("JoinSerial", serial)) return true;
  if (await tryInvoke("JoinGroup", room)) return true;
  if (await tryInvoke("Join", room)) return true;

  return false;
}

/** Rời group theo serial */
async function leaveSerialGroup(conn: HubConnection, serialRaw: string) {
  const serial = normalizeSerial(serialRaw);
  if (!serial) return false;

  const room = `serial:${serial}`;

  const tryInvoke = async (method: string, arg: any) => {
    try {
      await conn.invoke(method, arg);
      return true;
    } catch {
      return false;
    }
  };

  if (await tryInvoke("LeaveSerial", serial)) return true;
  if (await tryInvoke("LeaveGroup", room)) return true;
  if (await tryInvoke("Leave", room)) return true;

  return false;
}

export function useLiveReadings(
  selected: string | null,
  liveWindow: LiveWindow,
  liveMode: boolean
) {
  // ====== Stable HTTP ======
  const httpRef = useRef(createHttp());

  // ====== State ======
  const [liveData, setLiveData] = useState<Point[]>([]);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [liveUnavailable, setLiveUnavailable] = useState(false);
  const [connReadyTick, setConnReadyTick] = useState(0);

  // ====== Ref ======
  const connRef = useRef<HubConnection | null>(null);
  const currentSnRef = useRef<string>("");
  const joinedSnRef = useRef<string>("");
  const liveWindowRef = useRef<LiveWindow>(liveWindow);
  const batchRef = useRef<Point[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  const seedAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    liveWindowRef.current = liveWindow;
  }, [liveWindow]);

  useEffect(() => {
    currentSnRef.current = normalizeSerial(selected);
  }, [selected]);

  const flushRealtimeBatch = useCallback(() => {
    if (!mountedRef.current) return;
    if (!batchRef.current.length) return;

    const points = batchRef.current;
    batchRef.current = [];

    setLiveData((prev) => mergePoints(prev, points, liveWindowRef.current));
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current != null) return;

    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      flushRealtimeBatch();
    }, 160);
  }, [flushRealtimeBatch]);

  const softSeed = useCallback(
    async (serialRaw: string, windowValue: LiveWindow, signal?: AbortSignal) => {
      const serial = normalizeSerial(serialRaw);
      if (!serial) return;

      const data = await httpRef.current.dedupGet<any[]>(
        "/api/sensordata/GetRecent",
        {
          serialNumber: serial,
          window: windowValue,
        },
        signal
      );

      if (signal?.aborted || !mountedRef.current) return;

      const seed = mapPoints(Array.isArray(data) ? data : []);
      setLiveData((prev) => mergePoints(prev, seed, windowValue));
    },
    []
  );

  // Cleanup khi unmount toàn hook
  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      if (flushTimerRef.current) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }

      batchRef.current = [];

      seedAbortRef.current?.abort();
      seedAbortRef.current = null;

      const conn = connRef.current;
      const joined = joinedSnRef.current;

      if (conn && joined) {
        leaveSerialGroup(conn, joined).catch(() => {});
        joinedSnRef.current = "";
      }
    };
  }, []);

  // ====== Khởi tạo SignalR connection + handler khi liveMode bật ======
  useEffect(() => {
    if (!liveMode) {
      setLatencyMs(null);
      setLiveUnavailable(false);

      if (flushTimerRef.current) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }

      batchRef.current = [];

      const conn = connRef.current;
      const joined = joinedSnRef.current;

      if (conn && joined) {
        leaveSerialGroup(conn, joined).catch(() => {});
        joinedSnRef.current = "";
      }

      return;
    }

    let disposed = false;

    const onReading = (msg: any) => {
      if (!msg || disposed) return;

      const parsed = messageToPoint(msg);
      if (!parsed) return;

      const current = normalizeSerial(currentSnRef.current);
      if (!current || parsed.serial !== current) return;

      if (parsed.latencyMs !== null && Number.isFinite(parsed.latencyMs)) {
        setLatencyMs(parsed.latencyMs);
      }

      batchRef.current.push(parsed.point);
      scheduleFlush();
    };

    const start = async () => {
      try {
        const hubUrl = buildHubUrl();
        const conn = getLogTagConnection(
          hubUrl,
          () =>
            localStorage.getItem("accountId") ||
            localStorage.getItem("uid") ||
            ""
        );

        connRef.current = conn;
        (window as any).__logtag_conn = conn;

        // Đăng ký handler trước khi start để không miss event đầu tiên.
        for (const eventName of REALTIME_EVENTS) {
          try {
            conn.off(eventName, onReading as any);
            conn.on(eventName, onReading);
          } catch {
            // ignore
          }
        }

        await ensureStarted(conn);

        if (disposed) return;

        setConnReadyTick((x) => x + 1);

        // Fix quan trọng: join serial ngay sau khi connection sẵn sàng.
        const current = normalizeSerial(currentSnRef.current);
        if (current) {
          const joinedOk = await joinSerialGroup(conn, current);
          if (!disposed && joinedOk) {
            joinedSnRef.current = current;
          }
        }

        // Chỉ gắn onreconnected 1 lần cho singleton connection
        if (!(conn as any)[RECONNECTED_FLAG]) {
          conn.onreconnected(async () => {
            try {
              const current = normalizeSerial(currentSnRef.current);
              if (current) {
                const ok = await joinSerialGroup(conn, current);
                if (ok) joinedSnRef.current = current;
              }
            } catch {
              // ignore
            }
          });

          (conn as any)[RECONNECTED_FLAG] = true;
        }

        if (!disposed) setLiveUnavailable(false);
      } catch {
        if (!disposed) setLiveUnavailable(true);
      }
    };

    start();

    return () => {
      disposed = true;

      const conn = connRef.current;
      if (conn) {
        for (const eventName of REALTIME_EVENTS) {
          try {
            conn.off(eventName, onReading as any);
          } catch {
            // ignore
          }
        }
      }

      if (flushTimerRef.current) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }

      batchRef.current = [];
    };
  }, [liveMode, scheduleFlush]);

  // ====== Join / Leave serial khi selected thay đổi hoặc connection vừa sẵn sàng ======
  useEffect(() => {
    if (!liveMode) return;

    const conn = connRef.current;
    const next = normalizeSerial(selected);
    const prev = normalizeSerial(joinedSnRef.current);

    if (!conn || !next) return;
    if (prev === next) return;

    let canceled = false;

    const run = async () => {
      try {
        await ensureStarted(conn);
        if (canceled) return;

        if (prev) {
          await leaveSerialGroup(conn, prev);
        }

        if (canceled) return;

        const ok = await joinSerialGroup(conn, next);
        if (!canceled && ok) {
          joinedSnRef.current = next;
          setLiveUnavailable(false);
        }
      } catch {
        if (!canceled) setLiveUnavailable(true);
      }
    };

    run();

    return () => {
      canceled = true;
    };
  }, [selected, liveMode, connReadyTick]);

  // ====== Seed dữ liệu khi đổi selected / liveWindow / liveMode ======
  useEffect(() => {
    const serial = normalizeSerial(selected);

    if (!serial || !liveMode) {
      seedAbortRef.current?.abort();
      seedAbortRef.current = null;
      setLoading(false);
      setLatencyMs(null);
      return;
    }

    seedAbortRef.current?.abort();

    const ctrl = new AbortController();
    seedAbortRef.current = ctrl;

    const run = async () => {
      setLoading(true);

      try {
        await softSeed(serial, liveWindow, ctrl.signal);
      } catch (e: any) {
        if (e?.name !== "CanceledError" && e?.name !== "AbortError") {
          // Không clear data để tránh chart nhấp nháy khi request seed lỗi nhẹ.
        }
      } finally {
        if (!ctrl.signal.aborted && mountedRef.current) {
          setLoading(false);
        }
      }
    };

    run();

    return () => {
      ctrl.abort();
    };
  }, [selected, liveMode, liveWindow, softSeed]);

  // ====== Fallback tự refresh DB mỗi 30s nếu SignalR bị miss ======
  useEffect(() => {
    const serial = normalizeSerial(selected);
    if (!serial || !liveMode) return;

    let stopped = false;

    const tick = async () => {
      if (stopped || !mountedRef.current) return;
      try {
        await softSeed(serial, liveWindowRef.current);
      } catch {
        // fallback lỗi thì bỏ qua, SignalR vẫn tiếp tục chạy
      }
    };

    const id = window.setInterval(tick, FALLBACK_POLL_MS);

    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [selected, liveMode, softSeed]);

  return {
    liveData,
    latencyMs,
    loading,
    liveUnavailable,
  };
}
