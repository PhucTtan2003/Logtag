// src/hooks/useEventsRealtime.ts
import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import * as signalR from "@microsoft/signalr";

const API_BASE = process.env.REACT_APP_API_BASE_URL || "";

export type LiveStatusDto = {
  serialNumber: string;
  notes?: string | null;
  status: string;
  temperature?: number | null;
  humidity?: number | null;
  timeUtc: string;
};

export type LiveAlertDto = {
  serialNumber: string;
  notes?: string | null;
  message: string;
  timeUtc: string;
};

type Opts = {
  role: "user" | "admin";
  onStatus?: (items: LiveStatusDto[] | LiveStatusDto) => void;
  onAlert?: (items: LiveAlertDto[] | LiveAlertDto) => void;
  getAccessToken?: () => string | null;
};

const STATUS_EVENTS = [
  "ReceiveStatusUpdate",
  "ReadingUpdate",
  "ReceiveReading",
  "ReceiveLiveReading",
  "LiveReading",
] as const;

const ALERT_EVENTS = [
  "ReceiveAlert",
  "receivealert",
  "TemperatureAlert",
  "ReceiveTemperatureAlert",
] as const;

let sharedConnection: signalR.HubConnection | null = null;
let sharedConnectionKey = "";
let sharedStartPromise: Promise<void> | null = null;

function buildHubUrl() {
  const base = (API_BASE || "").replace(/\/+$/, "");
  return `${base}/hub/logtag`;
}

function toNumberOrNull(raw: any): number | null {
  if (raw === undefined || raw === null || raw === "") return null;

  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }

  const n = Number(String(raw).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function normalizeSerial(raw: any) {
  return String(raw ?? "").trim().toUpperCase();
}

function pickFirst(...values: any[]) {
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v !== undefined && v !== null && v !== "") return v;
  }

  return undefined;
}

function safeIsoTime(raw: any) {
  const v = pickFirst(raw);
  if (!v) return new Date().toISOString();

  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return new Date().toISOString();

  return d.toISOString();
}

/**
 * Map payload SignalR về camelCase cho FE.
 * Hỗ trợ cả payload từ:
 * - ReceiveStatusUpdate
 * - ReadingUpdate
 * - PascalCase / camelCase
 */
function mapStatusDto(raw: any): LiveStatusDto {
  if (!raw) {
    return {
      serialNumber: "",
      notes: null,
      status: "",
      temperature: null,
      humidity: null,
      timeUtc: new Date().toISOString(),
    };
  }

  const serialNumber = normalizeSerial(
    pickFirst(
      raw.serialNumber,
      raw.SerialNumber,
      raw.serial,
      raw.Serial,
      raw.deviceId,
      raw.DeviceId,
      raw.sn
    )
  );

  const temperature = toNumberOrNull(
    pickFirst(raw.temperature, raw.Temperature, raw.temp, raw.Temp)
  );

  const humidity = toNumberOrNull(
    pickFirst(raw.humidity, raw.Humidity, raw.rh, raw.RH)
  );

  const timeUtc = safeIsoTime(
    pickFirst(
      raw.timeUtc,
      raw.TimeUtc,
      raw.dateUtc,
      raw.DateUtc,
      raw.timestampUtc,
      raw.TimestampUtc,
      raw.createdAtUtc,
      raw.CreatedAtUtc,
      raw.createdAt,
      raw.CreatedAt
    )
  );

  const status = String(
    pickFirst(
      raw.status,
      raw.Status,
      temperature !== null || humidity !== null ? "Online" : ""
    )
  );

  return {
    serialNumber,
    notes: pickFirst(raw.notes, raw.Notes, null) ?? null,
    status,
    temperature,
    humidity,
    timeUtc,
  };
}

function mapAlertDto(raw: any): LiveAlertDto {
  if (!raw) {
    return {
      serialNumber: "",
      notes: null,
      message: "",
      timeUtc: new Date().toISOString(),
    };
  }

  return {
    serialNumber: normalizeSerial(
      pickFirst(
        raw.serialNumber,
        raw.SerialNumber,
        raw.serial,
        raw.Serial,
        raw.deviceId,
        raw.DeviceId,
        raw.sn
      )
    ),
    notes: pickFirst(raw.notes, raw.Notes, null) ?? null,
    message: String(
      pickFirst(
        raw.message,
        raw.Message,
        raw.title,
        raw.Title,
        raw.eventName,
        raw.EventName,
        "Cảnh báo nhiệt độ"
      )
    ),
    timeUtc: safeIsoTime(
      pickFirst(
        raw.timeUtc,
        raw.TimeUtc,
        raw.dateUtc,
        raw.DateUtc,
        raw.createdAtUtc,
        raw.CreatedAtUtc,
        raw.createdAt,
        raw.CreatedAt
      )
    ),
  };
}

function makeConnection(
  url: string,
  role: "user" | "admin",
  getAccessTokenRef: MutableRefObject<(() => string | null) | undefined>
) {
  const useBearer = typeof getAccessTokenRef.current === "function";
  const key = `${url}|${useBearer ? "bearer" : "cookie"}|${role}`;

  if (sharedConnection && sharedConnectionKey === key) {
    return sharedConnection;
  }

  if (sharedConnection) {
    const old = sharedConnection;
    sharedConnection = null;
    sharedConnectionKey = "";
    sharedStartPromise = null;

    old.stop().catch(() => {});
  }

  const builder = new signalR.HubConnectionBuilder()
    .withUrl(
      url,
      useBearer
        ? {
            accessTokenFactory: () => getAccessTokenRef.current?.() || "",
            skipNegotiation: true,
            transport: signalR.HttpTransportType.WebSockets,
          }
        : {
            withCredentials: true,
            skipNegotiation: true,
            transport: signalR.HttpTransportType.WebSockets,
          }
    )
    .withAutomaticReconnect({
      nextRetryDelayInMilliseconds: (ctx) => {
        const delays = [0, 2000, 5000, 10000, 15000, 30000];
        return delays[Math.min(ctx.previousRetryCount, delays.length - 1)];
      },
    });

  const connection = builder.build();

  connection.serverTimeoutInMilliseconds = 60_000;
  connection.keepAliveIntervalInMilliseconds = 15_000;

  connection.onreconnected(async () => {
    try {
      await connection.invoke("RefreshGroups");
      console.info("[SignalR] reconnected + refreshed groups");
    } catch (err) {
      console.warn("[SignalR] RefreshGroups failed after reconnect", err);
    }
  });

  connection.onclose((err) => {
    sharedStartPromise = null;

    if (err) {
      console.warn("[SignalR] closed", err);
    }
  });

  sharedConnection = connection;
  sharedConnectionKey = key;

  return connection;
}

async function ensureStarted(connection: signalR.HubConnection) {
  if (connection.state === signalR.HubConnectionState.Connected) return;

  if (connection.state !== signalR.HubConnectionState.Disconnected) {
    return;
  }

  if (sharedStartPromise) {
    return sharedStartPromise;
  }

  sharedStartPromise = (async () => {
    await connection.start();

    (window as any).__logtag_conn = connection;

    try {
      await connection.invoke("RefreshGroups");
    } catch (err) {
      console.warn("[SignalR] RefreshGroups failed after start", err);
    }

    console.info("[SignalR] connected", connection.connectionId);
  })();

  try {
    await sharedStartPromise;
  } finally {
    sharedStartPromise = null;
  }
}

function alertKey(a: LiveAlertDto) {
  return [
    normalizeSerial(a.serialNumber),
    a.message || "",
    a.timeUtc || "",
    a.notes || "",
  ].join("|");
}

export function useEventsRealtime({
  role,
  onStatus,
  onAlert,
  getAccessToken,
}: Opts) {
  const onStatusRef = useRef(onStatus);
  const onAlertRef = useRef(onAlert);
  const getAccessTokenRef = useRef(getAccessToken);

  const mountedRef = useRef(false);
  const statusBatchRef = useRef<LiveStatusDto[]>([]);
  const statusFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recentAlertKeysRef = useRef<Map<string, number>>(new Map());

  onStatusRef.current = onStatus;
  onAlertRef.current = onAlert;
  getAccessTokenRef.current = getAccessToken;

  useEffect(() => {
    mountedRef.current = true;

    const url = buildHubUrl();
    const connection = makeConnection(url, role, getAccessTokenRef);

    const flushStatusBatch = () => {
      if (!mountedRef.current) return;

      const batch = statusBatchRef.current;
      statusBatchRef.current = [];

      if (!batch.length) return;

      // Gộp theo serial, lấy bản mới nhất để giảm render dư.
      const map = new Map<string, LiveStatusDto>();

      for (let i = 0; i < batch.length; i++) {
        const item = batch[i];
        if (!item.serialNumber) continue;
        map.set(item.serialNumber, item);
      }

      const items: LiveStatusDto[] = [];
      map.forEach((item) => {
        items.push(item);
      });

      if (items.length === 1) {
        onStatusRef.current?.(items[0]);
      } else if (items.length > 1) {
        onStatusRef.current?.(items);
      }
    };

    const scheduleStatusFlush = () => {
      if (statusFlushTimerRef.current) return;

      statusFlushTimerRef.current = setTimeout(() => {
        statusFlushTimerRef.current = null;
        flushStatusBatch();
      }, 120);
    };

    const onStatusHandler = (payload: any) => {
      try {
        const arr = Array.isArray(payload) ? payload : [payload];

        const normalized: LiveStatusDto[] = [];
        for (let i = 0; i < arr.length; i++) {
          const item = mapStatusDto(arr[i]);
          if (item.serialNumber) normalized.push(item);
        }

        if (!normalized.length) return;

        statusBatchRef.current.push(...normalized);
        scheduleStatusFlush();
      } catch (e) {
        console.error("[SignalR] status handler failed", e);
      }
    };

    const onAlertHandler = (payload: any) => {
      try {
        const arr = Array.isArray(payload) ? payload : [payload];

        const normalized: LiveAlertDto[] = [];
        for (let i = 0; i < arr.length; i++) {
          const item = mapAlertDto(arr[i]);
          if (item.serialNumber && item.message) normalized.push(item);
        }

        if (!normalized.length) return;

        // Chống duplicate ngắn hạn do backend/server gửi cùng alert qua nhiều event name.
        const now = Date.now();
        const fresh: LiveAlertDto[] = [];

        for (let i = 0; i < normalized.length; i++) {
          const item = normalized[i];
          const key = alertKey(item);
          const last = recentAlertKeysRef.current.get(key) ?? 0;

          if (now - last < 2000) continue;

          recentAlertKeysRef.current.set(key, now);
          fresh.push(item);
        }

        // Dọn map để không phình bộ nhớ.
        // Không dùng for...of Map.entries() để tránh lỗi TS2802 khi target thấp hơn ES2015.
        recentAlertKeysRef.current.forEach((ts, key) => {
          if (now - ts > 5 * 60 * 1000) {
            recentAlertKeysRef.current.delete(key);
          }
        });

        if (!fresh.length) return;

        if (fresh.length === 1) {
          onAlertRef.current?.(fresh[0]);
        } else {
          onAlertRef.current?.(fresh);
        }
      } catch (e) {
        console.error("[SignalR] alert handler failed", e);
      }
    };

    const onAdminHandler = (payload: any) => {
      if (process.env.NODE_ENV !== "production") {
        console.debug("[SignalR] admin event", payload);
      }
    };

    // Clear handler cũ rồi đăng ký lại để tránh double handler trong React StrictMode.
    for (let i = 0; i < STATUS_EVENTS.length; i++) {
      const eventName = STATUS_EVENTS[i];
      connection.off(eventName, onStatusHandler as any);
      connection.on(eventName, onStatusHandler);
    }

    for (let i = 0; i < ALERT_EVENTS.length; i++) {
      const eventName = ALERT_EVENTS[i];
      connection.off(eventName, onAlertHandler as any);
      connection.on(eventName, onAlertHandler);
    }

    connection.off("ReceiveAdminEvent", onAdminHandler);
    connection.on("ReceiveAdminEvent", onAdminHandler);

    ensureStarted(connection).catch((err) => {
      if (mountedRef.current) {
        console.error("[SignalR] Failed to connect", err);
      }
    });

    // Dev simulate để test toast/status không cần backend.
    const devAlertHandler = (ev: any) => {
      try {
        const item = mapAlertDto(ev.detail);
        onAlertRef.current?.(item);
      } catch {
        // ignore
      }
    };

    const devStatusHandler = (ev: any) => {
      try {
        const item = mapStatusDto(ev.detail);
        onStatusRef.current?.(item);
      } catch {
        // ignore
      }
    };

    if (process.env.NODE_ENV !== "production") {
      window.addEventListener("dev-alert", devAlertHandler);
      window.addEventListener("dev-status", devStatusHandler);

      (window as any).simulateAlert = (
        payload: Partial<LiveAlertDto> = {}
      ) => {
        const sample: LiveAlertDto = {
          serialNumber: payload.serialNumber ?? "A0A2001951U5-CH1",
          notes: payload.notes ?? "Giá trị: 4.8°C, Ngưỡng: 9°C",
          message: payload.message ?? "Vượt ngưỡng dưới 9°C",
          timeUtc: payload.timeUtc ?? new Date().toISOString(),
        };

        window.dispatchEvent(new CustomEvent("dev-alert", { detail: sample }));
        return sample;
      };

      (window as any).simulateStatus = (
        payload: Partial<LiveStatusDto> = {}
      ) => {
        const sample: LiveStatusDto = {
          serialNumber: payload.serialNumber ?? "A0A2001951U5-CH1",
          notes: payload.notes ?? null,
          status: payload.status ?? "Online",
          temperature: payload.temperature ?? 4.8,
          humidity: payload.humidity ?? null,
          timeUtc: payload.timeUtc ?? new Date().toISOString(),
        };

        window.dispatchEvent(new CustomEvent("dev-status", { detail: sample }));
        return sample;
      };
    }

    return () => {
      mountedRef.current = false;

      if (statusFlushTimerRef.current) {
        clearTimeout(statusFlushTimerRef.current);
        statusFlushTimerRef.current = null;
      }

      statusBatchRef.current = [];

      for (let i = 0; i < STATUS_EVENTS.length; i++) {
        connection.off(STATUS_EVENTS[i], onStatusHandler as any);
      }

      for (let i = 0; i < ALERT_EVENTS.length; i++) {
        connection.off(ALERT_EVENTS[i], onAlertHandler as any);
      }

      connection.off("ReceiveAdminEvent", onAdminHandler);

      if (process.env.NODE_ENV !== "production") {
        window.removeEventListener("dev-alert", devAlertHandler);
        window.removeEventListener("dev-status", devStatusHandler);
      }

      // Không stop sharedConnection ở đây.
      // Lý do: tránh React StrictMode mount/unmount làm SignalR reconnect liên tục,
      // gây miss toast hoặc chart bị chậm nhận realtime.
    };
  }, [role]);
}
