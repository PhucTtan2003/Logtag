// src/pages/user/RealtimeStatus.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getLogTagConnection, ensureStarted } from "../../realtime/logtaghub";
import "../../styles/User/RealtimeStatus.css";

/** ================== Types (bám theo Hub) ================== */
type LiveAlertDto = {
  SerialNumber: string;
  Message: string;
  TimeUtc: string;
  Notes?: string | null;
  eventType?: string;
};

type LiveStatusDto = {
  SerialNumber: string;
  Notes?: string | null;
  Status?: string;
  Temperature?: number | null;
  Humidity?: number | null;
  TimeUtc?: string | null;
};

type ReadingUpdateDto = {
  SerialNumber: string;
  Temperature?: number | null;
  Humidity?: number | null;
  TimeUtc?: string;
  Notes?: string | null;
};

type DeviceNameRow = {
  userId?: string;
  teamId?: number | string;
  serialNumber?: string;
  name?: string | null;
  notes?: string | null;
  assignedAtUtc?: string;
};

type PowerState = "loss" | "restore" | "on" | "unknown";
type DeviceStatus = "Alert" | "Offline" | "Online";
type ViewMode = "compact" | "table" | "card";
type FilterMode = "all" | "alert" | "offline" | "online" | "nodata";
type SortMode = "priority" | "serial" | "latest" | "tempHigh" | "tempLow";

type CardModel = {
  serial: string;
  name?: string | null;
  temperature?: number | null;
  humidity?: number | null;
  last?: string | null;
  power: PowerState;
  status: DeviceStatus;
  alert?: LiveAlertDto | null;
};

/** ================== Config ================== */
const API_BASE = (process.env.REACT_APP_API_BASE_URL || "").replace(/\/+$/, "");

const HUB_CANDIDATES = [
  `${API_BASE}/hub/logtag`,
];
// Logger có thể ghi 10–15 phút/lần và upload trễ vài phút.
// 45 phút giúp tránh báo Offline giả, nhưng vẫn đủ nhanh để phát hiện mất dữ liệu.
const OFFLINE_THRESHOLD_MIN = 45;
const SERIAL_QUERY_CHUNK = 70;
const DEFAULT_RENDER_LIMIT = 80;
const LATEST_REFRESH_MS = 60 * 1000;

// Chỉ xem cảnh báo là active nếu còn mới.
// Đổi 30 -> 10 nếu muốn chỉ giữ cảnh báo trong 10 phút gần nhất.
const ALERT_RECENT_WINDOW_MIN = 30;
// Card sẽ nháy trong X phút sau khi có cảnh báo mới.
const ALERT_BLINK_WINDOW_MIN = 10;

// Cảnh báo chỉ được xem là active trong ALERT_RECENT_WINDOW_MIN.
// Đổi storage key để xóa cache v3 đang giữ cảnh báo cũ vô thời hạn.
const ACTIVE_ALERTS_STORAGE_KEY = "rtx-active-alerts-v4";
const LEGACY_ACTIVE_ALERTS_STORAGE_KEYS = [
  "rtx-active-alerts-v1",
  "rtx-active-alerts-v2",
  "rtx-active-alerts-v3",
];

// Chấp nhận sai lệch đồng hồ tối đa 2 phút về phía tương lai.
const ALERT_FUTURE_TOLERANCE_MIN = 2;

/** ================== Helpers ================== */
const fmtNum = (n?: number | null, unit = "") =>
  Number.isFinite(n as number) ? `${(n as number).toFixed(1)}${unit}` : "—";

const toVN = (d?: string | Date | null) =>
  d ? new Date(d).toLocaleString("vi-VN", { hour12: false }) : "—";

const toTimeVN = (d?: string | Date | null) =>
  d ? new Date(d).toLocaleTimeString("vi-VN", { hour12: false }) : "—";

const snNorm = (x: any) => String(x ?? "").trim().toUpperCase();

const baseSerialOf = (serial: string) =>
  snNorm(serial).replace(/-CH\d+$/i, "");

const normalizeDeviceName = (value: unknown) =>
  String(value ?? "").trim().replace(/\s+/g, " ");

const resolveDeviceName = (
  serial: string,
  names: Record<string, string>,
) => {
  const exact = snNorm(serial);
  const base = baseSerialOf(exact);

  return (
    normalizeDeviceName(names[exact]) ||
    normalizeDeviceName(names[base]) ||
    ""
  );
};

const isOffline = (iso?: string | null) => {
  if (!iso) return true;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return true;
  return Date.now() - t > OFFLINE_THRESHOLD_MIN * 60 * 1000;
};

const isRecentTime = (
  iso?: string | null,
  windowMin = ALERT_RECENT_WINDOW_MIN
) => {
  if (!iso) return false;

  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;

  const ageMs = Date.now() - t;
  const futureToleranceMs =
    ALERT_FUTURE_TOLERANCE_MIN * 60 * 1000;

  return (
    ageMs >= -futureToleranceMs &&
    ageMs <= windowMin * 60 * 1000
  );
};

const normalizeAlert = (it: any): LiveAlertDto | null => {
  const serial = snNorm(it?.SerialNumber ?? it?.serialNumber ?? it?.deviceId ?? it?.serial);
  if (!serial) return null;

  const time = String(
    it?.TimeUtc ??
    it?.timeUtc ??
    it?.DateUtc ??
    it?.dateUtc ??
    it?.timestampUtc ??
    it?.createdAtUtc ??
    new Date().toISOString()
  );

  return {
    SerialNumber: serial,
    Message: String(
      it?.Message ??
      it?.message ??
      it?.Notes ??
      it?.notes ??
      it?.eventName ??
      it?.eventType ??
      "Cảnh báo mới"
    ),
    TimeUtc: time,
    Notes: it?.Notes ?? it?.notes ?? null,
    eventType: String(it?.eventType ?? it?.Type ?? it?.type ?? "").toLowerCase(),
  };
};

const normalizeActiveAlerts = (
  map: Record<string, LiveAlertDto[]>,
) => {
  const next: Record<string, LiveAlertDto[]> = {};

  for (const [rawSerial, list] of Object.entries(map || {})) {
    const serial = snNorm(rawSerial);
    if (!serial) continue;

    // Chỉ giữ alert còn nằm trong cửa sổ realtime.
    // Event cũ hơn ALERT_RECENT_WINDOW_MIN sẽ bị loại khỏi card và drawer.
    const latest = (list || [])
      .map(normalizeAlert)
      .filter(
        (a): a is LiveAlertDto =>
          !!a &&
          isRecentTime(
            a.TimeUtc,
            ALERT_RECENT_WINDOW_MIN
          )
      )
      .sort(
        (a, b) =>
          Date.parse(b.TimeUtc) - Date.parse(a.TimeUtc),
      )[0];

    if (latest) next[serial] = [latest];
  }

  return next;
};

const loadActiveAlerts = (): Record<string, LiveAlertDto[]> => {
  try {
    // Xóa toàn bộ cache theo cơ chế cũ, đặc biệt v3 từng giữ alert vô thời hạn.
    LEGACY_ACTIVE_ALERTS_STORAGE_KEYS.forEach((key) => {
      localStorage.removeItem(key);
    });

    const raw = localStorage.getItem(
      ACTIVE_ALERTS_STORAGE_KEY
    );
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    return normalizeActiveAlerts(
      parsed && typeof parsed === "object" ? parsed : {},
    );
  } catch {
    return {};
  }
};

const saveActiveAlerts = (
  map: Record<string, LiveAlertDto[]>,
) => {
  try {
    const normalized = normalizeActiveAlerts(map);

    if (Object.keys(normalized).length === 0) {
      localStorage.removeItem(ACTIVE_ALERTS_STORAGE_KEY);
      return;
    }

    localStorage.setItem(
      ACTIVE_ALERTS_STORAGE_KEY,
      JSON.stringify(normalized),
    );
  } catch {
    // ignore
  }
};

const isRecoveryAlert = (alert?: LiveAlertDto | null) => {
  if (!alert) return false;

  const type = alertTypeOf(alert);
  const message = `${alert.Message || ""} ${alert.Notes || ""}`.toLowerCase();

  return (
    type === "temperature_stable" ||
    type === "temperature_recovered" ||
    type === "power_restore" ||
    message.includes("nhiệt độ của bạn đã ổn định") ||
    message.includes("nhiệt độ đã ổn định") ||
    message.includes("temperature stable") ||
    message.includes("temperature recovered") ||
    message.includes("power restored") ||
    message.includes("power restore")
  );
};

const alertTypeOf = (a?: any) => {
  const explicit = String(
    a?.eventType ??
    a?.Type ??
    a?.type ??
    ""
  )
    .trim()
    .toLowerCase();

  if (explicit) {
    if (
      explicit.includes("temperature") &&
      (
        explicit.includes("stable") ||
        explicit.includes("recover") ||
        explicit.includes("normal")
      )
    ) {
      return "temperature_stable";
    }

    if (
      explicit.includes("temperature") &&
      explicit.includes("alarm") &&
      explicit.includes("high")
    ) {
      return "temperature_alarm_high";
    }

    if (
      explicit.includes("temperature") &&
      explicit.includes("alarm") &&
      explicit.includes("low")
    ) {
      return "temperature_alarm_low";
    }

    if (
      explicit.includes("temperature") &&
      explicit.includes("alarm")
    ) {
      return "temperature_alarm";
    }

    if (
      explicit.includes("power") &&
      (
        explicit.includes("loss") ||
        explicit.includes("lost") ||
        explicit.includes("failure")
      )
    ) {
      return "power_loss";
    }

    if (
      explicit.includes("power") &&
      (
        explicit.includes("restore") ||
        explicit.includes("recovered") ||
        explicit.includes("back")
      )
    ) {
      return "power_restore";
    }

    return explicit;
  }

  // Một số DTO SignalR chỉ có Message, không có eventType.
  const message = String(
    a?.Message ??
    a?.message ??
    a?.Notes ??
    a?.notes ??
    ""
  ).toLowerCase();

  if (
    message.includes("nhiệt độ đã ổn định") ||
    message.includes("temperature stable") ||
    message.includes("temperature recovered")
  ) {
    return "temperature_stable";
  }

  if (
    message.includes("power loss") ||
    message.includes("power lost") ||
    message.includes("mất nguồn") ||
    message.includes("mất điện")
  ) {
    return "power_loss";
  }

  if (
    message.includes("power restore") ||
    message.includes("power restored") ||
    message.includes("nguồn trở lại") ||
    message.includes("khôi phục nguồn")
  ) {
    return "power_restore";
  }

  if (
    message.includes("temperature") &&
    message.includes("alarm")
  ) {
    return "temperature_alarm";
  }

  return "";
};

const powerFromAlerts = (
  list: LiveAlertDto[] | undefined
): PowerState => {
  if (!list || list.length === 0) return "unknown";

  const hasLoss = list.some(
    a => alertTypeOf(a) === "power_loss"
  );

  const hasRestore = list.some(
    a => alertTypeOf(a) === "power_restore"
  );

  if (hasLoss) return "loss";
  if (hasRestore) return "restore";

  // Cảnh báo nhiệt độ hoặc pin không chứng minh thiết bị đang POWER ON.
  return "unknown";
};

const statusFrom = (hasActiveAlert: boolean, lastIso?: string | null): DeviceStatus => {
  if (hasActiveAlert) return "Alert";
  if (isOffline(lastIso)) return "Offline";
  return "Online";
};

function toNumOrNull(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mergeNumber(incoming: any, previous?: number | null): number | null {
  if (incoming === undefined || incoming === null || incoming === "") {
    return previous ?? null;
  }
  return toNumOrNull(incoming);
}

function getIdentityHeaders(): Record<string, string> {
  const uid =
    localStorage.getItem("userId") ||
    localStorage.getItem("uid") ||
    localStorage.getItem("accountId") ||
    "";

  return uid ? { "X-User-Id": uid } : {};
}

function dateMs(value?: string | Date | null): number {
  if (!value) return Number.NaN;
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(ms) ? ms : Number.NaN;
}

function isIncomingSameOrNewer(
  incoming?: string | Date | null,
  current?: string | Date | null
): boolean {
  const incomingMs = dateMs(incoming);
  const currentMs = dateMs(current);

  if (!Number.isFinite(currentMs)) return true;
  if (!Number.isFinite(incomingMs)) return false;

  return incomingMs >= currentMs;
}

function readingTimeOf(x: any): string | null {
  const raw =
    x?.DateUtc ??
    x?.dateUtc ??
    x?.ReadingTimeUtc ??
    x?.readingTimeUtc ??
    x?.lastReadingUtc ??
    x?.LastReadingUtc ??
    x?.lastSeenUtc ??
    x?.LastSeenUtc ??
    x?.last ??
    x?.TimeUtc ??
    x?.timeUtc ??
    null;

  return raw ? String(raw) : null;
}

function hasRealMeasurement(x: any): boolean {
  return (
    toNumOrNull(x?.Temperature ?? x?.temperature) !== null ||
    toNumOrNull(x?.Humidity ?? x?.humidity) !== null
  );
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function ageText(iso?: string | null) {
  if (!iso) return "Chưa có dữ liệu";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "Không rõ";
  const diffMin = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (diffMin < 1) return "vừa xong";
  if (diffMin < 60) return `${diffMin} phút trước`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h} giờ trước`;
  return `${Math.floor(h / 24)} ngày trước`;
}

async function joinSerialGroup(conn: any, serial: string) {
  const room = `serial:${snNorm(serial)}`;
  const tryInvoke = async (m: string, arg: any) => {
    try { await conn.invoke(m, arg); return true; } catch { return false; }
  };
  if (await tryInvoke("JoinSerial", serial)) return;
  if (await tryInvoke("JoinGroup", room)) return;
  if (await tryInvoke("Join", room)) return;
}

/** ================== API ================== */
async function fetchMySerials(): Promise<string[]> {
  const headers: Record<string, string> = {
    "X-User-Id":
      localStorage.getItem("userId") ||
      localStorage.getItem("uid") ||
      localStorage.getItem("accountId") ||
      "",
  };

  const res = await fetch(`${API_BASE}/api/sensordata/GetDeviceSerials`, {
    credentials: "include",
    headers,
  });

  if (!res.ok) return [];
  const data = await res.json();

  return (Array.isArray(data) ? data : data?.data ?? [])
    .map(snNorm)
    .filter(Boolean);
}

async function fetchMyDeviceNames(): Promise<Record<string, string>> {
  const res = await fetch(`${API_BASE}/api/device-names/mine`, {
    method: "GET",
    credentials: "include",
    headers: getIdentityHeaders(),
  });

  if (!res.ok) {
    console.warn(
      "[Realtime] Không tải được tên thiết bị:",
      res.status,
    );
    return {};
  }

  const payload = await res.json();
  const rows: DeviceNameRow[] = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.items)
        ? payload.items
        : [];

  const names: Record<string, string> = {};

  for (const row of rows) {
    const serial = snNorm(row?.serialNumber);
    const name = normalizeDeviceName(
      row?.name ?? row?.notes,
    );

    if (serial && name) {
      names[serial] = name;
    }
  }

  return names;
}

async function fetchLatestReadings(serials: string[]) {
  const clean = Array.from(new Set(serials.map(snNorm).filter(Boolean)));
  if (!clean.length) return [] as LiveStatusDto[];

  const bySerial = new Map<string, LiveStatusDto>();

  const mergeRawRows = (payload: any) => {
    const data = Array.isArray(payload) ? payload : payload?.data ?? [];

    for (const x of data || []) {
      const serial = snNorm(
        x?.serial ??
        x?.serialNumber ??
        x?.SerialNumber ??
        x?.deviceId
      );

      if (!serial || !clean.includes(serial)) continue;

      const incoming: LiveStatusDto = {
        SerialNumber: serial,
        Notes: x?.notes ?? x?.name ?? x?.deviceName ?? x?.Notes ?? null,
        Status: x?.status ?? x?.Status ?? undefined,
        Temperature: toNumOrNull(x?.temperature ?? x?.Temperature),
        Humidity: toNumOrNull(x?.humidity ?? x?.Humidity),
        TimeUtc: readingTimeOf(x),
      };

      const current = bySerial.get(serial);

      // API status/live đôi khi trả cache cũ hơn SensorData/latest.
      // Chỉ cho bản có timestamp mới hơn ghi đè nhiệt độ/thời gian hiện tại.
      if (
        !current ||
        isIncomingSameOrNewer(incoming.TimeUtc, current.TimeUtc)
      ) {
        bySerial.set(serial, {
          SerialNumber: serial,
          Notes: incoming.Notes ?? current?.Notes ?? null,
          Status: incoming.Status ?? current?.Status,
          Temperature: mergeNumber(
            incoming.Temperature,
            current?.Temperature
          ),
          Humidity: mergeNumber(
            incoming.Humidity,
            current?.Humidity
          ),
          TimeUtc: incoming.TimeUtc ?? current?.TimeUtc ?? null,
        });
      } else {
        // Bản cũ chỉ được bổ sung metadata, tuyệt đối không kéo lùi reading.
        bySerial.set(serial, {
          ...current,
          Notes: current.Notes ?? incoming.Notes ?? null,
          Status: current.Status ?? incoming.Status,
        });
      }
    }
  };

  const headers = getIdentityHeaders();

  for (const part of chunk(clean, SERIAL_QUERY_CHUNK)) {
    // Không "continue" ngay khi status/live trả 200.
    // Luôn đọc thêm SensorData/latest rồi chọn bản mới nhất cho từng serial.
    try {
      const url =
        `${API_BASE}/api/status/live?serials=${encodeURIComponent(part.join(","))}`;
      const r = await fetch(url, {
        credentials: "include",
        headers,
      });

      if (r.ok) mergeRawRows(await r.json());
      else console.debug("[Realtime] /api/status/live:", r.status);
    } catch (err) {
      console.debug("[Realtime] /api/status/live unavailable", err);
    }

    let latestGetOk = false;

    try {
      const url =
        `${API_BASE}/api/sensordata/latest?serials=${encodeURIComponent(part.join(","))}`;
      const r = await fetch(url, {
        credentials: "include",
        headers,
      });

      if (!r.ok) throw new Error(`GET latest HTTP ${r.status}`);

      mergeRawRows(await r.json());
      latestGetOk = true;
    } catch (err) {
      console.debug("[Realtime] GET /api/sensordata/latest unavailable", err);
    }

    if (!latestGetOk) {
      try {
        const url = `${API_BASE}/api/sensordata/latest`;
        const r = await fetch(url, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
          body: JSON.stringify({ serials: part }),
        });

        if (!r.ok) throw new Error(`POST latest HTTP ${r.status}`);
        mergeRawRows(await r.json());
      } catch (err) {
        console.warn("[Realtime] latest fallback failed", err);
      }
    }
  }

  return Array.from(bySerial.values());
}

/** ================== Component ================== */
export default function RealtimeStatus() {
  const navigate = useNavigate();

  const [serials, setSerials] = useState<string[]>([]);
  const [cards, setCards] = useState<Record<string, CardModel>>({});
  const [deviceNames, setDeviceNames] =
    useState<Record<string, string>>({});
  const deviceNamesRef = useRef(deviceNames);

  const [alertsMap, setAlertsMap] =
    useState<Record<string, LiveAlertDto[]>>(loadActiveAlerts);
  const alertsMapRef = useRef(alertsMap);

  const [soundEnabled, setSoundEnabled] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [sort, setSort] = useState<SortMode>("priority");
  const [view, setView] = useState<ViewMode>(() =>
    (localStorage.getItem("rtx-view") as ViewMode) || "compact"
  );
  const [renderLimit, setRenderLimit] = useState(DEFAULT_RENDER_LIMIT);
  const [selectedSerial, setSelectedSerial] = useState<string | null>(null);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [, setNowTick] = useState(Date.now());

  useEffect(() => {
    alertsMapRef.current = alertsMap;
    saveActiveAlerts(alertsMap);
  }, [alertsMap]);

  useEffect(() => {
    deviceNamesRef.current = deviceNames;

    setCards(prev => {
      const next = { ...prev };

      for (const serial of Object.keys(next)) {
        const mappedName = resolveDeviceName(
          serial,
          deviceNames,
        );

        if (mappedName) {
          next[serial] = {
            ...next[serial],
            name: mappedName,
          };
        }
      }

      return next;
    });
  }, [deviceNames]);

  const mergeLatestStatuses = (rows: LiveStatusDto[]) => {
    setCards(prev => {
      const next = { ...prev };

      for (const s of rows || []) {
        const serial = snNorm(s.SerialNumber);
        if (!serial) continue;

        const cur = next[serial];
        const aList =
          alertsMapRef.current[serial] || [];

        const incomingTime = s.TimeUtc ?? null;
        const acceptReading =
          !cur ||
          isIncomingSameOrNewer(incomingTime, cur.last);

        const lastIso = acceptReading
          ? (incomingTime ?? cur?.last ?? null)
          : (cur?.last ?? null);

        next[serial] = {
          serial,
          name:
            resolveDeviceName(
              serial,
              deviceNamesRef.current,
            ) ||
            normalizeDeviceName(s.Notes) ||
            cur?.name ||
            null,
          temperature: acceptReading
            ? mergeNumber(s.Temperature, cur?.temperature)
            : cur?.temperature ?? null,
          humidity: acceptReading
            ? mergeNumber(s.Humidity, cur?.humidity)
            : cur?.humidity ?? null,
          last: lastIso,
          power: aList.length
            ? powerFromAlerts(aList)
            : "unknown",
          status: statusFrom(aList.length > 0, lastIso),
          alert: aList[0] ?? null,
        };
      }

      return next;
    });
  };

  useEffect(() => {
    localStorage.setItem("rtx-view", view);
  }, [view]);

  useEffect(() => {
    setRenderLimit(DEFAULT_RENDER_LIMIT);
  }, [query, filter, sort, view]);

  // Mỗi phút cập nhật Online/Offline và loại cảnh báo quá 30 phút.
  // Event recovery vẫn có thể clear cảnh báo sớm hơn.
  useEffect(() => {
    const refreshTemporalState = () => {
      setNowTick(Date.now());

      const activeMap = normalizeActiveAlerts(
        alertsMapRef.current
      );

      // Cập nhật ref ngay để các handler SignalR dùng đúng map mới nhất.
      alertsMapRef.current = activeMap;
      setAlertsMap(activeMap);

      setCards(prev => {
        const next = { ...prev };

        for (const serial of Object.keys(next)) {
          const aList = activeMap[serial] || [];
          const cur = next[serial];

          next[serial] = {
            ...cur,
            power: aList.length
              ? powerFromAlerts(aList)
              : "unknown",
            status: statusFrom(
              aList.length > 0,
              cur.last
            ),
            alert: aList[0] ?? null,
          };
        }

        return next;
      });
    };

    refreshTemporalState();

    const t = window.setInterval(
      refreshTemporalState,
      60_000
    );

    return () => window.clearInterval(t);
  }, []);

  const activeAlertCount = useMemo(
    () =>
      Object.values(alertsMap).reduce(
        (count, list) => count + (list?.length ? 1 : 0),
        0,
      ),
    [alertsMap],
  );

  const allCards = useMemo(() => {
    const keys = new Set<string>([...serials, ...Object.keys(cards)].map(snNorm).filter(Boolean));

    return Array.from(keys).map(serial => {
      const cur = cards[serial];
      const aList = alertsMap[serial] || [];
      const model: CardModel = {
        serial,
        name:
          resolveDeviceName(serial, deviceNames) ||
          cur?.name ||
          null,
        temperature: cur?.temperature ?? null,
        humidity: cur?.humidity ?? null,
        last: cur?.last ?? null,
        power: aList.length
          ? powerFromAlerts(aList)
          : "unknown",
        status: statusFrom(aList.length > 0, cur?.last ?? null),
        alert: aList[0] ?? null,
      };
      return model;
    });
  }, [serials, cards, alertsMap]);

  const stats = useMemo(() => {
    const total = allCards.length;
    const alert = allCards.filter(c => c.status === "Alert").length;
    const offline = allCards.filter(c => c.status === "Offline").length;
    const online = allCards.filter(c => c.status === "Online").length;
    const noData = allCards.filter(c => !c.last).length;
    return { total, alert, offline, online, noData };
  }, [allCards]);

  const healthRate = useMemo(() => {
    if (!stats.total) return 0;
    return Math.round((stats.online / stats.total) * 100);
  }, [stats.online, stats.total]);

  const attentionCount = stats.alert + stats.offline;

  const visibleCards = useMemo(() => {
    const keyword = snNorm(query);
    const priority = (s: DeviceStatus) => (s === "Alert" ? 0 : s === "Offline" ? 1 : 2);

    let arr = allCards.filter(c => {
      const hay = `${c.serial} ${c.name ?? ""}`.toUpperCase();
      if (keyword && !hay.includes(keyword)) return false;
      if (filter === "alert") return c.status === "Alert";
      if (filter === "offline") return c.status === "Offline";
      if (filter === "online") return c.status === "Online";
      if (filter === "nodata") return !c.last;
      return true;
    });

    arr = arr.sort((a, b) => {
      if (sort === "priority") {
        const d = priority(a.status) - priority(b.status);
        if (d) return d;
        const la = a.last ? Date.parse(a.last) : 0;
        const lb = b.last ? Date.parse(b.last) : 0;
        if (lb !== la) return lb - la;
      }
      if (sort === "latest") {
        return (b.last ? Date.parse(b.last) : 0) - (a.last ? Date.parse(a.last) : 0);
      }
      if (sort === "tempHigh") {
        return (b.temperature ?? -9999) - (a.temperature ?? -9999);
      }
      if (sort === "tempLow") {
        return (a.temperature ?? 9999) - (b.temperature ?? 9999);
      }
      const na = (a.name || a.serial) + "";
      const nb = (b.name || b.serial) + "";
      return na.localeCompare(nb, "vi");
    });

    return arr;
  }, [allCards, query, filter, sort]);

  const shownCards = useMemo(
    () => visibleCards.slice(0, renderLimit),
    [visibleCards, renderLimit]
  );

  const selectedCard = useMemo(
    () => allCards.find(c => c.serial === selectedSerial) ?? null,
    [allCards, selectedSerial]
  );

  useEffect(() => {
    if (!selectedSerial) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedSerial(null);
      }
    };

    window.addEventListener("keydown", onEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onEscape);
    };
  }, [selectedSerial]);

  const lastUpdate = useMemo(() => {
    const arr = allCards.map(c => c.last).filter(Boolean) as string[];
    const ts = Math.max(0, ...arr.map(x => Date.parse(x)));
    return ts > 0 ? new Date(ts) : null;
  }, [allCards]);

  /** ====== Audio ====== */
  const ensurePlaying = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
  };

  // Click vào bất kỳ card nào chỉ tắt âm đang phát.
  // Trạng thái card đỏ và alert active vẫn được giữ cho đến khi thiết bị ổn định.
  const stopCurrentAlertSound = () => {
    const el = audioRef.current;
    if (!el) return;

    el.pause();
    el.currentTime = 0;
  };

  const handleCardSelect = (serial: string) => {
    stopCurrentAlertSound();
    setSelectedSerial(serial);
  };

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    if (soundEnabled && activeAlertCount > 0) {
      ensurePlaying();
    } else {
      el.pause();
      el.currentTime = 0;
    }
  }, [activeAlertCount, soundEnabled]);

  useEffect(() => {
    const el = audioRef.current;
    if (el) el.muted = !soundEnabled;
  }, [soundEnabled]);

  /** ====== Mount: serials + prime + hub ====== */
  useEffect(() => {
    let hub: any;
    let isMounted = true;

    let onStatusHandler: ((payload: any) => void) | null = null;
    let onReadingHandler: ((payload: any) => void) | null = null;
    let onAlertHandler: ((payload: any) => void) | null = null;
    let onAlertClearedHandler: ((payload: any) => void) | null = null;

    (async () => {
      const [serialRows, loadedNames] = await Promise.all([
        fetchMySerials(),
        fetchMyDeviceNames(),
      ]);

      const mySerials = Array.from(
        new Set(serialRows.map(snNorm).filter(Boolean)),
      );

      if (!isMounted) return;

      deviceNamesRef.current = loadedNames;
      setDeviceNames(loadedNames);
      setSerials(mySerials);

      // Show all assigned devices immediately. Devices without latest data still appear as Offline/No data.
      setCards(prev => {
        const next = { ...prev };
        for (const serial of mySerials) {
          if (!next[serial]) {
            next[serial] = {
              serial,
              name:
                resolveDeviceName(
                  serial,
                  loadedNames,
                ) || null,
              temperature: null,
              humidity: null,
              last: null,
              power: "unknown",
              status: "Offline",
              alert: null,
            };
          }
        }
        return next;
      });

      if (mySerials.length) {
        const prime = await fetchLatestReadings(mySerials);
        if (!isMounted) return;

        mergeLatestStatuses(prime);
      }

      const tokenFactory = () =>
        localStorage.getItem("userId") ||
        localStorage.getItem("uid") ||
        localStorage.getItem("accountId") ||
        "";

      let connected = false;
      for (const url of HUB_CANDIDATES) {
        try {
          hub = getLogTagConnection(url, tokenFactory);
          await ensureStarted(hub);
          connected = true;
          console.log("[Realtime] connected to", url);
          break;
        } catch (e) {
          console.warn("[Realtime] connect failed:", url, e);
        }
      }
      if (!connected) return;

      for (const sn of mySerials) {
        try { await joinSerialGroup(hub, sn); } catch {}
      }

      hub.onreconnected(async () => {
        for (const sn of mySerials) await joinSerialGroup(hub, sn);
      });

      const onStatus = (payload: LiveStatusDto | LiveStatusDto[] | any) => {
        const arr = Array.isArray(payload) ? payload : [payload];

        setCards(prev => {
          const next = { ...prev };

          for (const it of arr) {
            const serial = snNorm(
              it?.SerialNumber ??
              it?.serialNumber ??
              it?.deviceId ??
              it?.serial
            );

            if (
              !serial ||
              (mySerials.length && !mySerials.includes(serial))
            ) continue;

            const cur = next[serial];
            const aList =
              alertsMapRef.current[serial] || [];

            const incomingTemp = it?.Temperature ?? it?.temperature;
            const incomingHum = it?.Humidity ?? it?.humidity;
            const hasMeasurement = hasRealMeasurement(it);

            // Chỉ TimeUtc của gói có measurement mới được xem là thời gian đo.
            // Gói status-only có thể dùng TimeUtc là thời điểm phát broadcast.
            const incomingReadingTime = hasMeasurement
              ? readingTimeOf(it)
              : (
                  it?.DateUtc ??
                  it?.dateUtc ??
                  it?.ReadingTimeUtc ??
                  it?.readingTimeUtc ??
                  it?.last ??
                  null
                );

            const acceptReading =
              hasMeasurement &&
              (
                !cur ||
                isIncomingSameOrNewer(
                  incomingReadingTime,
                  cur?.last
                )
              );

            const lastIso = acceptReading
              ? (incomingReadingTime ?? cur?.last ?? null)
              : (cur?.last ?? null);

            const power = aList.length
              ? powerFromAlerts(aList)
              : "unknown";

            let nextStatus = statusFrom(
              aList.length > 0,
              lastIso
            );

            const rawStatus = String(
              it?.Status ?? it?.status ?? ""
            ).trim().toLowerCase();

            // Không cho một status cache cũ ghi đè bản ReadingUpdate mới.
            // Chỉ nhận Offline khi timestamp đo thực sự đã quá hạn.
            if (
              !aList.length &&
              rawStatus === "offline" &&
              isOffline(lastIso)
            ) {
              nextStatus = "Offline";
            }

            next[serial] = {
              serial,
              name:
                resolveDeviceName(
                  serial,
                  deviceNamesRef.current,
                ) ||
                normalizeDeviceName(
                  it?.Notes ??
                  it?.notes ??
                  it?.name ??
                  it?.deviceName,
                ) ||
                cur?.name ||
                null,
              temperature: acceptReading
                ? mergeNumber(incomingTemp, cur?.temperature)
                : cur?.temperature ?? null,
              humidity: acceptReading
                ? mergeNumber(incomingHum, cur?.humidity)
                : cur?.humidity ?? null,
              last: lastIso,
              power,
              status: nextStatus,
              alert: aList[0] ?? null,
            };
          }

          return next;
        });
      };

      onStatusHandler = onStatus;
      hub.off("ReceiveStatusUpdate", onStatus);
      hub.off("receivestatusupdate", onStatus);
      hub.on("ReceiveStatusUpdate", onStatus);
      hub.on("receivestatusupdate", onStatus);

      const onReading = (payload: ReadingUpdateDto | ReadingUpdateDto[] | any) => {
        const arr = Array.isArray(payload) ? payload : [payload];

        setCards(prev => {
          const next = { ...prev };

          for (const it of arr) {
            const serial = snNorm(
              it?.SerialNumber ??
              it?.serialNumber ??
              it?.deviceId ??
              it?.serial
            );

            if (
              !serial ||
              (mySerials.length && !mySerials.includes(serial))
            ) continue;

            const cur = next[serial];
            const incomingTime =
              readingTimeOf(it) ??
              new Date().toISOString();

            // Chống REST/status cache cũ hoặc SignalR đến sai thứ tự
            // kéo lùi thời gian và nhiệt độ của card.
            if (
              cur?.last &&
              !isIncomingSameOrNewer(incomingTime, cur.last)
            ) {
              console.debug(
                "[Realtime] ignore stale reading",
                serial,
                incomingTime,
                cur.last
              );
              continue;
            }

            const aList =
              alertsMapRef.current[serial] || [];

            const power = aList.length
              ? powerFromAlerts(aList)
              : "unknown";

            next[serial] = {
              serial,
              name:
                resolveDeviceName(
                  serial,
                  deviceNamesRef.current,
                ) ||
                normalizeDeviceName(
                  it?.Notes ?? it?.notes,
                ) ||
                cur?.name ||
                null,
              temperature: mergeNumber(
                it?.Temperature ?? it?.temperature,
                cur?.temperature
              ),
              humidity: mergeNumber(
                it?.Humidity ?? it?.humidity,
                cur?.humidity
              ),
              last: incomingTime,
              power,
              status: statusFrom(
                aList.length > 0,
                incomingTime
              ),
              alert: aList[0] ?? null,
            };
          }

          return next;
        });
      };

      onReadingHandler = onReading;
      hub.off("ReadingUpdate", onReading);
      hub.off("readingupdate", onReading);
      hub.on("ReadingUpdate", onReading);
      hub.on("readingupdate", onReading);

      const onAlert = (
        dto: LiveAlertDto | LiveAlertDto[] | any,
      ) => {
        const arr = Array.isArray(dto) ? dto : [dto];

        const incoming = arr
          .map(normalizeAlert)
          .filter(
            (a): a is LiveAlertDto =>
              !!a &&
              isRecentTime(a.TimeUtc) &&
              (!mySerials.length || mySerials.includes(a.SerialNumber)),
          );

        if (!incoming.length) return;

        const recoverySerials = new Set(
          incoming
            .filter(isRecoveryAlert)
            .map(a => a.SerialNumber),
        );

        const alarmAlerts = incoming.filter(
          a => !isRecoveryAlert(a),
        );

        setAlertsMap(prev => {
          const map = normalizeActiveAlerts(prev);

          recoverySerials.forEach((serial) => {
            delete map[serial];
          });

          for (const alert of alarmAlerts) {
            map[alert.SerialNumber] = [alert];
          }

          return map;
        });

        setCards(prev => {
          const next = { ...prev };

          recoverySerials.forEach((serial) => {
            const cur = next[serial];
            if (!cur) return;

            next[serial] = {
              ...cur,
              power: "unknown",
              status: statusFrom(false, cur.last),
              alert: null,
            };
          });

          for (const alert of alarmAlerts) {
            const serial = alert.SerialNumber;
            const cur = next[serial] || ({ serial } as CardModel);

            next[serial] = {
              ...cur,
              power: powerFromAlerts([alert]),
              status: "Alert",
              alert,
            };
          }

          return next;
        });

        if (alarmAlerts.length > 0) {
          const el = audioRef.current;
          if (soundEnabled && el && el.paused) {
            el.play().catch(() => {});
          }
        }
      };

      onAlertHandler = onAlert;
      hub.off("ReceiveAlert", onAlert);
      hub.off("receivealert", onAlert);
      hub.off("event", onAlert);
      hub.on("ReceiveAlert", onAlert);
      hub.on("receivealert", onAlert);
      hub.on("event", onAlert);

      const onAlertCleared = (payload: any | any[]) => {
        const arr = Array.isArray(payload) ? payload : [payload];
        setAlertsMap(prev => {
          const map = { ...prev };
          for (const it of arr) {
            const serial = snNorm(it.SerialNumber ?? it.serialNumber ?? it.deviceId ?? it.serial);
            if (serial) delete map[serial];
          }
          return map;
        });

        setCards(prev => {
          const next = { ...prev };
          for (const it of arr) {
            const serial = snNorm(it.SerialNumber ?? it.serialNumber ?? it.deviceId ?? it.serial);
            if (!serial) continue;
            const cur = next[serial];
            if (!cur) continue;
            next[serial] = {
              ...cur,
              power: "unknown",
              status: statusFrom(false, cur.last),
              alert: null,
            };
          }
          return next;
        });
      };

      onAlertClearedHandler = onAlertCleared;
      hub.off("AlertCleared", onAlertCleared);
      hub.off("alertcleared", onAlertCleared);
      hub.on("AlertCleared", onAlertCleared);
      hub.on("alertcleared", onAlertCleared);

      try { await hub.invoke("RefreshGroups"); } catch {}
      try {
        const latestAfterHub = await fetchLatestReadings(mySerials);
        if (isMounted) mergeLatestStatuses(latestAfterHub);
      } catch {}
    })();

    return () => {
      isMounted = false;
      try {
        if (hub && onStatusHandler) {
          hub.off("ReceiveStatusUpdate", onStatusHandler);
          hub.off("receivestatusupdate", onStatusHandler);
        }
      } catch {}

      try {
        if (hub && onReadingHandler) {
          hub.off("ReadingUpdate", onReadingHandler);
          hub.off("readingupdate", onReadingHandler);
        }
      } catch {}

      try {
        if (hub && onAlertHandler) {
          hub.off("ReceiveAlert", onAlertHandler);
          hub.off("receivealert", onAlertHandler);
          hub.off("event", onAlertHandler);
        }
      } catch {}

      try {
        if (hub && onAlertClearedHandler) {
          hub.off("AlertCleared", onAlertClearedHandler);
          hub.off("alertcleared", onAlertClearedHandler);
        }
      } catch {}
      const el = audioRef.current;
      if (el) el.pause();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const refreshLatest = async () => {
      if (disposed || serials.length === 0) return;
      try {
        const [latest, loadedNames] = await Promise.all([
          fetchLatestReadings(serials),
          fetchMyDeviceNames(),
        ]);

        if (!disposed) {
          deviceNamesRef.current = loadedNames;
          setDeviceNames(loadedNames);
          mergeLatestStatuses(latest);
        }
      } catch (err) {
        console.warn("[Realtime] refresh latest failed", err);
      }
    };
    const timer = window.setInterval(refreshLatest, LATEST_REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") refreshLatest(); };
    const onFocus = () => refreshLatest();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [serials]);

  const refreshNow = async () => {
    if (manualRefreshing || serials.length === 0) return;

    setManualRefreshing(true);
    try {
      const [latest, loadedNames] = await Promise.all([
        fetchLatestReadings(serials),
        fetchMyDeviceNames(),
      ]);

      deviceNamesRef.current = loadedNames;
      setDeviceNames(loadedNames);
      mergeLatestStatuses(latest);
    } catch (err) {
      console.warn("[Realtime] manual refresh failed", err);
    } finally {
      setManualRefreshing(false);
    }
  };

  /** ====== UI ====== */
  return (
    <div className="rtx rtx-ops">
      <header className="rtx-header" role="banner">
        <div className="rtx-header-left">
          <button
            className="rtx-back"
            onClick={() => navigate("/user")}
            aria-label="Trở về"
            title="Trở về"
          >
            <span>←</span>
          </button>

          <div className="rtx-titles">
            <div className="rtx-title-eyebrow">
              <span className="rtx-live-pulse" />
              TRUNG TÂM GIÁM SÁT REALTIME
            </div>
            <h1>Giám sát thiết bị</h1>
            <p className="rtx-sub">
              Theo dõi nhiệt độ, độ ẩm, kết nối và cảnh báo theo thời gian thực
            </p>
          </div>
        </div>

        <div className="rtx-header-right">
          <div className={`rtx-system-state ${attentionCount > 0 ? "attention" : "healthy"}`}>
            <span className="state-dot" />
            <div>
              <small>Trạng thái hệ thống</small>
              <b>{attentionCount > 0 ? `${attentionCount} thiết bị cần xử lý` : "Vận hành ổn định"}</b>
            </div>
          </div>

          <button
            className="rtx-refresh-btn"
            onClick={refreshNow}
            disabled={manualRefreshing || serials.length === 0}
            title="Làm mới dữ liệu"
          >
            <span className={manualRefreshing ? "spin" : ""}>↻</span>
            {manualRefreshing ? "Đang cập nhật" : "Làm mới"}
          </button>

          <label
            className="rtx-switch"
            title={soundEnabled ? "Tắt âm cảnh báo" : "Bật âm cảnh báo"}
          >
            <input
              type="checkbox"
              checked={soundEnabled}
              onChange={(e) => setSoundEnabled(e.target.checked)}
              aria-label="Bật tắt âm cảnh báo"
            />
            <span className="slider" />
            <span className="label">
              {soundEnabled ? "Âm báo bật" : "Âm báo tắt"}
            </span>
          </label>
        </div>
      </header>

      <section className="rtx-monitor-overview" aria-label="Tổng quan giám sát">
        <div className="rtx-health-panel">
          <div className="rtx-health-copy">
            <span className="rtx-section-kicker">SỨC KHỎE HỆ THỐNG</span>
            <div className="rtx-health-value">
              <b>{healthRate}%</b>
              <span>thiết bị đang hoạt động bình thường</span>
            </div>
          </div>

          <div className="rtx-health-track" aria-label={`Sức khỏe hệ thống ${healthRate}%`}>
            <span style={{ width: `${healthRate}%` }} />
          </div>

          <div className="rtx-health-meta">
            <span>
              Cập nhật gần nhất
              <b>{lastUpdate ? toVN(lastUpdate) : "Chưa có dữ liệu"}</b>
            </span>
            <span>
              Cửa sổ cảnh báo
              <b>{ALERT_RECENT_WINDOW_MIN} phút gần nhất</b>
            </span>
          </div>
        </div>

        <div className="rtx-summary">
          <SummaryCard
            icon="◫"
            label="Tổng thiết bị"
            hint="Thiết bị được phân quyền"
            value={stats.total || serials.length}
            tone="neutral"
          />
          <SummaryCard
            icon="●"
            label="Đang online"
            hint={`Có dữ liệu trong ${OFFLINE_THRESHOLD_MIN} phút`}
            value={stats.online}
            tone="ok"
          />
          <SummaryCard
            icon="!"
            label="Đang cảnh báo"
            hint="Ưu tiên kiểm tra ngay"
            value={stats.alert}
            tone="danger"
          />
          <SummaryCard
            icon="⌁"
            label="Mất cập nhật"
            hint={`Quá ${OFFLINE_THRESHOLD_MIN} phút`}
            value={stats.offline}
            tone="warn"
          />
          <SummaryCard
            icon="—"
            label="Chưa có dữ liệu"
            hint="Chưa nhận reading"
            value={stats.noData}
            tone="muted"
          />
        </div>
      </section>

      <section
        className={`rtx-incident-strip ${
          attentionCount > 0 ? "has-incident" : "is-nominal"
        }`}
        aria-live="polite"
      >
        <div className="rtx-incident-mark">
          {attentionCount > 0 ? "!" : "✓"}
        </div>

        <div className="rtx-incident-copy">
          <span>TRẠNG THÁI VẬN HÀNH</span>
          <b>
            {attentionCount > 0
              ? `${attentionCount} thiết bị cần được kiểm tra`
              : "Tất cả thiết bị đang vận hành ổn định"}
          </b>
          <small>
            {attentionCount > 0
              ? "Thiết bị cảnh báo và mất cập nhật đã được đưa lên đầu danh sách."
              : `Không ghi nhận cảnh báo hoặc mất cập nhật quá ${OFFLINE_THRESHOLD_MIN} phút.`}
          </small>
        </div>

        <div className="rtx-incident-actions">
          {stats.alert > 0 && (
            <button
              className="danger"
              onClick={() => setFilter("alert")}
            >
              Xem {stats.alert} cảnh báo
            </button>
          )}

          {stats.offline > 0 && (
            <button
              className="warning"
              onClick={() => setFilter("offline")}
            >
              Xem {stats.offline} mất cập nhật
            </button>
          )}

          {attentionCount === 0 && (
            <button onClick={() => setFilter("all")}>
              Xem toàn bộ thiết bị
            </button>
          )}
        </div>
      </section>

      <section className="rtx-toolbar" aria-label="Bộ lọc thiết bị">
        <div className="rtx-quick-filters" aria-label="Lọc nhanh">
          <button
            className={filter === "all" ? "active" : ""}
            onClick={() => setFilter("all")}
          >
            Tất cả <b>{stats.total}</b>
          </button>
          <button
            className={filter === "alert" ? "active danger" : "danger"}
            onClick={() => setFilter("alert")}
          >
            Cảnh báo <b>{stats.alert}</b>
          </button>
          <button
            className={filter === "offline" ? "active warning" : "warning"}
            onClick={() => setFilter("offline")}
          >
            Mất kết nối <b>{stats.offline}</b>
          </button>
          <button
            className={filter === "online" ? "active success" : "success"}
            onClick={() => setFilter("online")}
          >
            Online <b>{stats.online}</b>
          </button>
        </div>

        <div className="rtx-toolbar-main">
        <div className="rtx-toolbar-left">
          <div className="rtx-chip rtx-last-update">
            ⏱ Lần cập nhật gần nhất: <b>{lastUpdate ? toVN(lastUpdate) : "—"}</b>
          </div>
          <div className="rtx-search-wrap">
            <span>🔎</span>
            <input
              className="rtx-search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Tìm serial / tên thiết bị..."
            />
          </div>
        </div>

        <div className="rtx-toolbar-right">
          <select className="rtx-select" value={filter} onChange={e => setFilter(e.target.value as FilterMode)}>
            <option value="all">Tất cả</option>
            <option value="alert">Đang cảnh báo</option>
            <option value="offline">Offline / mất cập nhật</option>
            <option value="online">Online</option>
            <option value="nodata">Chưa có dữ liệu</option>
          </select>

          <select className="rtx-select" value={sort} onChange={e => setSort(e.target.value as SortMode)}>
            <option value="priority">Ưu tiên xử lý</option>
            <option value="latest">Mới cập nhật</option>
            <option value="serial">Serial A-Z</option>
            <option value="tempHigh">Nhiệt độ cao</option>
            <option value="tempLow">Nhiệt độ thấp</option>
          </select>

          <div className="rtx-view-toggle" role="group" aria-label="Chế độ xem">
            <button className={view === "compact" ? "active" : ""} onClick={() => setView("compact")}>Compact</button>
            <button className={view === "table" ? "active" : ""} onClick={() => setView("table")}>Table</button>
            <button className={view === "card" ? "active" : ""} onClick={() => setView("card")}>Card</button>
          </div>
        </div>
        </div>
      </section>

      <section className="rtx-result-meta">
        <div>
          <span className="rtx-result-title">Danh sách thiết bị</span>
          <span>
            Hiển thị <b>{Math.min(shownCards.length, visibleCards.length)}</b>/<b>{visibleCards.length}</b>
            {query ? <> · Từ khóa: <b>{query}</b></> : null}
          </span>
        </div>
        <div className="rtx-legend">
          <span><i className="ok" /> Online</span>
          <span><i className="warn" /> Mất cập nhật</span>
          <span><i className="danger" /> Cảnh báo</span>
        </div>
      </section>

      {visibleCards.length === 0 ? (
        <div className="rtx-empty">
          <div className="rtx-empty-card">
            <div className="rtx-empty-icon">🛡️</div>
            <h3>Không có thiết bị phù hợp</h3>
            <p>Thử đổi bộ lọc hoặc tìm serial khác.</p>
          </div>
        </div>
      ) : view === "table" ? (
        <DeviceTable rows={shownCards} onSelect={handleCardSelect} />
      ) : view === "compact" ? (
        <div className="rtx-compact-grid">
          {shownCards.map(c => (
            <CompactDeviceCard key={c.serial} card={c} onSelect={handleCardSelect} />
          ))}
        </div>
      ) : (
        <div className="rtx-grid">
          {shownCards.map(c => (
            <LargeDeviceCard key={c.serial} card={c} onSelect={handleCardSelect} />
          ))}
        </div>
      )}

      {visibleCards.length > shownCards.length && (
        <div className="rtx-load-more">
          <button onClick={() => setRenderLimit(x => x + DEFAULT_RENDER_LIMIT)}>
            Xem thêm {Math.min(DEFAULT_RENDER_LIMIT, visibleCards.length - shownCards.length)} thiết bị
          </button>
        </div>
      )}

      {selectedCard && (
        <>
          <button
            className="rtx-drawer-backdrop"
            aria-label="Đóng bảng chi tiết thiết bị"
            onClick={() => setSelectedSerial(null)}
          />

          <aside
            className={`rtx-drawer ${clsStatus(selectedCard.status)}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="rtx-device-detail-title"
          >
            <header className="rtx-drawer-head">
              <div className={`rtx-drawer-status ${clsStatus(selectedCard.status)}`}>
                <span className={`rtx-dot ${dotClass(selectedCard.status)}`} />
                {statusText(selectedCard.status)}
              </div>

              <button
                className="rtx-drawer-close"
                onClick={() => setSelectedSerial(null)}
                aria-label="Đóng"
                title="Đóng"
              >
                ×
              </button>
            </header>

            <section className="rtx-drawer-device">
              <div className={`rtx-drawer-device-icon ${clsStatus(selectedCard.status)}`}>
                {selectedCard.status === "Alert"
                  ? "!"
                  : selectedCard.status === "Offline"
                    ? "⌁"
                    : "✓"}
              </div>

              <div className="rtx-drawer-device-copy">
                <span>CHI TIẾT THIẾT BỊ</span>
                <h2 id="rtx-device-detail-title">
                  {selectedCard.name || "Thiết bị LogTag"}
                </h2>
                <div className="rtx-drawer-serial">
                  {selectedCard.serial}
                </div>
              </div>
            </section>

            <section className="rtx-drawer-live-section">
              <div className="rtx-drawer-section-title">
                <span>GIÁ TRỊ HIỆN TẠI</span>
                <b className={`rtx-drawer-live-badge ${freshnessClass(selectedCard.last)}`}>
                  <i />
                  {freshnessText(selectedCard.last)}
                </b>
              </div>

              <div
                className={`rtx-drawer-metrics ${
                  selectedCard.power === "unknown"
                    ? "without-power"
                    : "with-power"
                }`}
              >
                <div className="temperature">
                  <span className="metric-symbol">T</span>
                  <small>Nhiệt độ</small>
                  <b>{fmtNum(selectedCard.temperature, "°C")}</b>
                </div>

                <div className="humidity">
                  <span className="metric-symbol">H</span>
                  <small>Độ ẩm</small>
                  <b>{fmtNum(selectedCard.humidity, "%")}</b>
                </div>

                {selectedCard.power !== "unknown" && (
                  <div className="power">
                    <span className="metric-symbol">P</span>
                    <small>Nguồn</small>
                    <b>{powerText(selectedCard.power)}</b>
                  </div>
                )}
              </div>
            </section>

            <section className="rtx-drawer-timeline">
              <div>
                <span>Cập nhật gần nhất</span>
                <b>{toVN(selectedCard.last)}</b>
              </div>

              {/* <div>
                <span>Độ trễ dữ liệu</span>
                <b>{ageText(selectedCard.last)}</b>
              </div> */}

              <div>
                <span>Cửa sổ cảnh báo</span>
                <b>{ALERT_RECENT_WINDOW_MIN} phút gần nhất</b>
              </div>
            </section>

            {selectedCard.alert && (
              <section className="rtx-drawer-alert-section">
                <div className="rtx-drawer-section-title">
                  <span>CẢNH BÁO ĐANG HOẠT ĐỘNG</span>
                  <b>{toTimeVN(selectedCard.alert.TimeUtc)}</b>
                </div>

                <div className="rtx-alert-box drawer-alert">
                  <div className="rtx-alert-icon">!</div>
                  <div className="rtx-alert-text">
                    <div className="title">Cần kiểm tra thiết bị</div>
                    <div className="msg">
                      {selectedCard.alert.Message}
                    </div>
                    <div className="time">
                      Sự kiện lúc {toVN(selectedCard.alert.TimeUtc)}
                    </div>
                  </div>
                </div>
              </section>
            )}

            <footer className="rtx-drawer-actions">
              <button
                className="rtx-copy-btn"
                onClick={() =>
                  navigator.clipboard
                    ?.writeText(selectedCard.serial)
                    .catch(() => {})
                }
              >
                <span>⧉</span>
                Sao chép serial
              </button>

              <button
                className="rtx-drawer-secondary"
                onClick={() => setSelectedSerial(null)}
              >
                Đóng
              </button>
            </footer>
          </aside>
        </>
      )}

      <audio
        ref={audioRef}
        src="/alarm.mp3"
        preload="auto"
        muted={!soundEnabled}
        loop
        onError={(e) => console.warn("❌ Audio failed to load", e)}
      />
    </div>
  );
}

/** ================== Render helpers ================== */
/** Card có cảnh báo mới thì nháy để user thấy ngay. */
function shouldBlinkAlert(card: CardModel) {
  return (
    card.status === "Alert" &&
    !!card.alert &&
    isRecentTime(card.alert.TimeUtc, ALERT_BLINK_WINDOW_MIN)
  );
}

function SummaryCard({
  icon,
  label,
  hint,
  value,
  tone,
}: {
  icon: string;
  label: string;
  hint: string;
  value: number;
  tone: "neutral" | "ok" | "warn" | "danger" | "muted";
}) {
  return (
    <div className={`rtx-summary-card ${tone}`}>
      <div className="rtx-summary-topline">
        <div className="rtx-summary-icon">{icon}</div>
        <span className="rtx-summary-state" />
      </div>

      <div className="rtx-summary-content">
        <span className="rtx-summary-label">{label}</span>
        <b>{value}</b>
        <small>{hint}</small>
      </div>
    </div>
  );
}

function CompactDeviceCard({
  card,
  onSelect,
}: {
  card: CardModel;
  onSelect: (serial: string) => void;
}) {
  const blink = shouldBlinkAlert(card);
  const freshness = freshnessClass(card.last);

  return (
    <button
      className={`rtx-compact-card ${clsStatus(card.status)} ${freshness} ${
        blink ? "rtx-alert-blink" : ""
      }`}
      onClick={() => onSelect(card.serial)}
    >
      <span
        className={`rtx-card-status-rail ${clsStatus(card.status)}`}
        aria-hidden
      />

      <div className="rtx-compact-head">
        <div className="rtx-compact-identity">
          <div className="rtx-identity-line">
            <span
              className={`rtx-dot ${dotClass(card.status)} ${
                blink ? "rtx-dot-blink" : ""
              }`}
            />
            <strong title={card.name || card.serial}>
              {card.name || card.serial}
            </strong>
          </div>

          <small title={card.serial}>
            {card.name ? card.serial : "Thiết bị LogTag"}
          </small>
        </div>

        <div className="rtx-compact-temperature">
          <span>Nhiệt độ</span>
          <b>{fmtNum(card.temperature, "°C")}</b>
        </div>
      </div>

      <div className="rtx-compact-body">
        <div className="rtx-chip-row">
          <span className={`mini-badge ${statusBadge(card.status)}`}>
            {statusText(card.status)}
          </span>

          {card.power !== "unknown" && (
            <span className={`mini-badge ${powerBadge(card.power)}`}>
              {cardPowerShort(card.power)}
            </span>
          )}
        </div>

        <div className={`rtx-freshness ${freshness}`}>
          <i />
          <span>{freshnessText(card.last)}</span>
          <b>{ageText(card.last)}</b>
        </div>
      </div>

      <span className={`rtx-freshness-line ${freshness}`} aria-hidden />
    </button>
  );
}

function DeviceTable({
  rows,
  onSelect,
}: {
  rows: CardModel[];
  onSelect: (serial: string) => void;
}) {
  const showPower = rows.some(
    (card) => card.power !== "unknown"
  );

  return (
    <div className="rtx-table-wrap">
      <table className="rtx-table">
        <thead>
          <tr>
            <th>Trạng thái</th>
            <th>Thiết bị</th>
            <th>Nhiệt độ</th>
            <th>Độ ẩm</th>
            {showPower && <th>Nguồn</th>}
            <th>Độ mới dữ liệu</th>
            <th>Cập nhật</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((card) => {
            const freshness = freshnessClass(card.last);

            return (
              <tr
                key={card.serial}
                className={
                  shouldBlinkAlert(card)
                    ? "rtx-alert-blink-row"
                    : ""
                }
                onClick={() => onSelect(card.serial)}
              >
                <td>
                  <span
                    className={`status-pill ${clsStatus(card.status)}`}
                  >
                    <i className={`rtx-dot ${dotClass(card.status)}`} />
                    {statusText(card.status)}
                  </span>
                </td>

                <td className="serial-cell">
                  <strong>{card.name || card.serial}</strong>
                  <small>
                    {card.name ? card.serial : "Thiết bị LogTag"}
                  </small>
                </td>

                <td className="rtx-table-number">
                  {fmtNum(card.temperature, "°C")}
                </td>

                <td className="rtx-table-number">
                  {fmtNum(card.humidity, "%")}
                </td>

                {showPower && (
                  <td>
                    {card.power !== "unknown" && (
                      <span
                        className={`mini-badge ${powerBadge(card.power)}`}
                      >
                        {cardPowerShort(card.power)}
                      </span>
                    )}
                  </td>
                )}

                <td>
                  <span className={`rtx-table-freshness ${freshness}`}>
                    <i />
                    {freshnessText(card.last)}
                  </span>
                </td>

                <td>
                  <span>{toTimeVN(card.last)}</span>
                  <small>{ageText(card.last)}</small>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LargeDeviceCard({
  card,
  onSelect,
}: {
  card: CardModel;
  onSelect: (serial: string) => void;
}) {
  const blink = shouldBlinkAlert(card);
  const freshness = freshnessClass(card.last);

  return (
    <article
      className={`rtx-card ${clsStatus(card.status)} ${freshness} ${
        blink ? "rtx-alert-blink" : ""
      }`}
      aria-live="polite"
      aria-atomic="true"
      onClick={() => onSelect(card.serial)}
    >
      <span
        className={`rtx-card-status-rail ${clsStatus(card.status)}`}
        aria-hidden
      />

      <header className="rtx-card-head">
        <div className="rtx-card-identity">
          <div className="rtx-identity-line">
            <span
              className={`rtx-dot ${dotClass(card.status)} ${
                blink ? "rtx-dot-blink" : ""
              }`}
              aria-hidden
            />
            <h3 className="rtx-name">
              {card.name || `Thiết bị ${card.serial}`}
            </h3>
          </div>

          <small>{card.serial}</small>
        </div>

        <div className="rtx-card-badges">
          <span className={`rtx-badge ${statusBadge(card.status)}`}>
            {statusText(card.status)}
          </span>

          {card.power !== "unknown" && (
            <span className={`rtx-badge ${powerBadge(card.power)}`}>
              {cardPowerShort(card.power)}
            </span>
          )}
        </div>
      </header>

      <div className="rtx-card-metrics">
        <div className="rtx-metric-tile temperature">
          <div className="rtx-metric-icon">T</div>
          <div>
            <span>Nhiệt độ hiện tại</span>
            <b>{fmtNum(card.temperature, "°C")}</b>
          </div>
        </div>

        <div className="rtx-metric-tile humidity">
          <div className="rtx-metric-icon">H</div>
          <div>
            <span>Độ ẩm hiện tại</span>
            <b>{fmtNum(card.humidity, "%")}</b>
          </div>
        </div>
      </div>

      <div className="rtx-card-operations">
        <div>
          <span>Cập nhật lần cuối</span>
          <b>{toVN(card.last)}</b>
        </div>

        <div>
          <span>Độ mới dữ liệu</span>
          <b className={`rtx-freshness-value ${freshness}`}>
            <i />
            {freshnessText(card.last)} · {ageText(card.last)}
          </b>
        </div>
      </div>

      {card.status === "Alert" && card.alert && (
        <div className="rtx-alert-box">
          <div className="rtx-alert-icon" aria-hidden>
            !
          </div>

          <div className="rtx-alert-text">
            <div className="title">Cảnh báo đang hoạt động</div>
            <div className="msg">{card.alert.Message}</div>
            <div className="time">{toVN(card.alert.TimeUtc)}</div>
          </div>
        </div>
      )}

      <div className="rtx-card-open">
        <span>Xem chi tiết thiết bị</span>
        <b>→</b>
      </div>
    </article>
  );
}


function AlertBlinkStyle() {
  return (
    <style>{`
      @keyframes rtxAlertPulse {
        0%, 100% {
          border-color: rgba(239, 68, 68, 0.55);
          box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08), 0 0 0 0 rgba(239, 68, 68, 0.34);
          transform: translateY(0) scale(1);
        }
        50% {
          border-color: rgba(239, 68, 68, 1);
          box-shadow: 0 18px 42px rgba(239, 68, 68, 0.22), 0 0 0 7px rgba(239, 68, 68, 0.12);
          transform: translateY(-1px) scale(1.012);
        }
      }

      @keyframes rtxDotPulse {
        0%, 100% {
          box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.45);
          transform: scale(1);
        }
        50% {
          box-shadow: 0 0 0 6px rgba(239, 68, 68, 0.12);
          transform: scale(1.12);
        }
      }

      .rtx-alert-blink {
        position: relative;
        border-color: rgba(239, 68, 68, 0.75) !important;
        background: linear-gradient(135deg, rgba(255, 245, 245, 0.98), rgba(255, 255, 255, 0.96)) !important;
        animation: rtxAlertPulse 1.15s ease-in-out infinite;
      }

      .rtx-alert-blink::after {
        content: "VƯỢT NGƯỠNG";
        position: absolute;
        top: 8px;
        right: 10px;
        padding: 4px 8px;
        border-radius: 999px;
        font-size: 10px;
        font-weight: 900;
        letter-spacing: 0.04em;
        color: #b91c1c;
        background: rgba(254, 226, 226, 0.95);
        border: 1px solid rgba(248, 113, 113, 0.45);
        pointer-events: none;
      }

      .rtx-dot-blink,
      .rtx-alert-blink .rtx-dot {
        background: #ef4444 !important;
        animation: rtxDotPulse 1s ease-in-out infinite;
      }

      .rtx-table tbody tr.rtx-alert-blink-row {
        background: rgba(254, 242, 242, 0.95) !important;
        animation: rtxAlertPulse 1.25s ease-in-out infinite;
      }

      .rtx-table tbody tr.rtx-alert-blink-row .status-pill {
        background: #fee2e2 !important;
        color: #b91c1c !important;
        border-color: rgba(239, 68, 68, 0.35) !important;
      }

      @media (prefers-reduced-motion: reduce) {
        .rtx-alert-blink,
        .rtx-alert-blink-row,
        .rtx-dot-blink,
        .rtx-alert-blink .rtx-dot {
          animation: none !important;
        }
      }
    `}</style>
  );
}

/** ================== UI helpers ================== */
function powerText(p: PowerState) {
  switch (p) {
    case "loss":
      return "POWER LOSS";
    case "restore":
      return "POWER RESTORE";
    case "on":
      return "POWER ON";
    default:
      return "";
  }
}

function cardPowerShort(p: PowerState) {
  switch (p) {
    case "loss":
      return "MẤT NGUỒN";
    case "restore":
      return "NGUỒN KHÔI PHỤC";
    case "on":
      return "CÓ NGUỒN";
    default:
      return "";
  }
}

function powerBadge(p: PowerState) {
  switch (p) {
    case "loss":
      return "bdg-danger";
    case "restore":
      return "bdg-success";
    case "on":
      return "bdg-info";
    default:
      return "bdg-muted";
  }
}

function statusText(s: DeviceStatus) {
  switch (s) {
    case "Alert":
      return "Cảnh báo";
    case "Offline":
      return "Mất cập nhật";
    default:
      return "Online";
  }
}

function statusBadge(s: DeviceStatus) {
  return s === "Alert"
    ? "bdg-danger"
    : s === "Offline"
      ? "bdg-warn"
      : "bdg-success";
}

function freshnessClass(iso?: string | null) {
  if (!iso) return "freshness-empty";

  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) {
    return "freshness-empty";
  }

  const minutes = Math.max(
    0,
    Math.floor((Date.now() - timestamp) / 60000)
  );

  if (minutes <= 10) return "freshness-live";
  if (minutes <= OFFLINE_THRESHOLD_MIN) {
    return "freshness-delayed";
  }

  return "freshness-stale";
}

function freshnessText(iso?: string | null) {
  switch (freshnessClass(iso)) {
    case "freshness-live":
      return "Dữ liệu mới";
    case "freshness-delayed":
      return "Đang chờ bản ghi";
    case "freshness-stale":
      return "Dữ liệu trễ";
    default:
      return "Chưa có dữ liệu";
  }
}

function dotClass(s: DeviceStatus) {
  return s === "Alert"
    ? "dot-danger"
    : s === "Offline"
      ? "dot-warn"
      : "dot-ok";
}

function clsStatus(s: DeviceStatus) {
  return s === "Alert"
    ? "rtx-alert"
    : s === "Offline"
      ? "rtx-offline"
      : "rtx-online";
}