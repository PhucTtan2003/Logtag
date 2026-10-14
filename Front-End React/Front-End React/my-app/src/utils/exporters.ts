import api from "../api/axios";
import { userIdHeader } from "./http";
import type { LiveWindow } from "../types/liveWindow";
import { exportPdf as exportSmartTechPdf } from "../pages/User/userchart/exports/exportPdf";
import { buildExportRange, type NormalizedExportRange } from "./../utils/exportRange";

type PdfArgs = {
  selectedDevice: string;
  liveMode: boolean;
  liveWindow: LiveWindow;
  fromUtc: string;
  toUtc: string;
  fromLocal: string;
  toLocal: string;
  tMin: number;
  tMax: number;
  hMin: number;
  hMax: number;
  chartPanel?: HTMLElement | null;

  // Được truyền từ ExportButtons/ChartBox sau khi đã normalize.
  // Nếu có các giá trị này thì KHÔNG build lại range nữa.
  rangeText?: string;
  rangeLabel?: string;
  rangeDisplayText?: string;
  rangeDays?: number;
  normalizedRange?: NormalizedExportRange;
};

type ExportPoint = {
  timestamp: number;
  time: string;
  label: string;
  temperature: number;
  humidity: number;
  serialNumber?: string;
  serial?: string;
  event?: string;
  events?: string;
  eventType?: string;
  [key: string]: any;
};

const TEMP_THRESHOLDS = { min: 2, max: 8 };
const HUM_THRESHOLDS = { min: 30, max: 70 };

const WINDOW_MS: Record<string, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

function normalizeSerial(v: any) {
  return String(v || "").trim().toUpperCase();
}

function safeFilePart(value: string) {
  return String(value || "report")
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, "_")
    .slice(0, 90);
}

function parseMs(raw: any): number | null {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date) {
    const ms = raw.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof raw === "number") {
    const ms = raw < 10_000_000_000 ? raw * 1000 : raw;
    return Number.isFinite(ms) ? ms : null;
  }
  const ms = new Date(String(raw)).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function fmtLocal(ms: number) {
  return new Date(ms).toLocaleString("vi-VN", {
    hour12: false,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtLocalShort(ms: number | null) {
  if (ms == null) return "--";
  return new Date(ms).toLocaleString("vi-VN", {
    hour12: false,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function selectedRangeLabel(fromUtc: string, toUtc: string) {
  const f = parseMs(fromUtc);
  const t = parseMs(toUtc);
  const diffDays = f != null && t != null ? Math.max(1, Math.ceil((t - f) / 86_400_000)) : null;
  const label = diffDays ? `Khoảng đã chọn (${diffDays} ngày)` : "Khoảng đã chọn";
  return `Dữ liệu xuất: ${label} • ${fmtLocalShort(f)} → ${fmtLocalShort(t)}`;
}

function pick(...values: any[]) {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function extractRows(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.readings)) return payload.readings;
  if (Array.isArray(payload?.result)) return payload.result;
  return [];
}

function rowSerial(row: any) {
  return normalizeSerial(
    pick(
      row?.serialNumber,
      row?.SerialNumber,
      row?.serial,
      row?.Serial,
      row?.deviceId,
      row?.DeviceId,
      row?.sn,
      row?.SN,
    ),
  );
}

function rowMatchesSelected(row: any, selectedDevice: string) {
  const s = rowSerial(row);
  // Nếu backend endpoint đã filter và row không có serial field thì vẫn nhận.
  // Nếu row có serial field thì bắt buộc match exact để tránh admin đổi thiết bị nhưng lấy nhầm data con khác.
  return !s || s === normalizeSerial(selectedDevice);
}

function normalizeApiPoint(row: any, selectedDevice: string, index: number): ExportPoint | null {
  const rawTime = pick(
    row?.timestamp,
    row?.Timestamp,
    row?.time,
    row?.Time,
    row?.dateUtc,
    row?.DateUtc,
    row?.timeUtc,
    row?.TimeUtc,
    row?.timestampUtc,
    row?.TimestampUtc,
    row?.createdAt,
    row?.createAt,
    row?.label,
  );

  const timestamp = parseMs(rawTime) ?? Date.now() + index;
  const temperatureRaw = pick(row?.temperature, row?.Temperature, row?.temp, row?.Temp);
  const humidityRaw = pick(row?.humidity, row?.Humidity, row?.rh, row?.RH);
  const temperature = Number(temperatureRaw);
  const humidity = Number(humidityRaw ?? 0);

  if (!Number.isFinite(temperature)) return null;

  return {
    ...row,
    timestamp,
    time: new Date(timestamp).toISOString(),
    label: fmtLocal(timestamp),
    temperature,
    humidity: Number.isFinite(humidity) ? humidity : 0,
    serialNumber: selectedDevice,
    serial: selectedDevice,
    event: pick(row?.event, row?.events, row?.eventType, row?.marker),
  };
}

function normalizeRows(rows: any[], selectedDevice: string): ExportPoint[] {
  return rows
    .filter((r) => rowMatchesSelected(r, selectedDevice))
    .map((r, i) => normalizeApiPoint(r, selectedDevice, i))
    .filter((p): p is ExportPoint => !!p)
    .sort((a, b) => a.timestamp - b.timestamp);
}

function filterByUtcRange(points: ExportPoint[], fromUtc: string, toUtc: string) {
  const fromMs = parseMs(fromUtc);
  const toMs = parseMs(toUtc);
  if (fromMs == null || toMs == null) return points;
  return points.filter((p) => p.timestamp >= fromMs && p.timestamp <= toMs);
}

function liveRange(liveWindow: LiveWindow) {
  const to = new Date();
  const ms = WINDOW_MS[String(liveWindow)] || WINDOW_MS["1h"];
  const from = new Date(to.getTime() - ms);
  return { fromUtc: from.toISOString(), toUtc: to.toISOString() };
}

function closestWindowByRange(fromUtc: string, toUtc: string): LiveWindow {
  const fromMs = parseMs(fromUtc) ?? Date.now();
  const toMs = parseMs(toUtc) ?? Date.now();
  const diff = Math.max(0, toMs - fromMs);
  if (diff <= WINDOW_MS["1h"]) return "1h" as LiveWindow;
  if (diff <= WINDOW_MS["6h"]) return "6h" as LiveWindow;
  if (diff <= WINDOW_MS["24h"]) return "24h" as LiveWindow;
  return "7d" as LiveWindow;
}

async function getRows(url: string, params: Record<string, any>) {
  const res = await api.get(url, {
    params,
    headers: { ...userIdHeader() },
  });
  return extractRows(res.data);
}

async function fetchRecentPoints(selectedDevice: string, liveWindow: LiveWindow) {
  const params = {
    serial: selectedDevice,
    serialNumber: selectedDevice,
    deviceId: selectedDevice,
    sn: selectedDevice,
    window: liveWindow,
  };

  const rows = await getRows("/api/sensordata/GetRecent", params);
  return normalizeRows(rows, selectedDevice);
}

async function fetchRangePoints(selectedDevice: string, fromUtc: string, toUtc: string) {
  const params = {
    serial: selectedDevice,
    serialNumber: selectedDevice,
    deviceId: selectedDevice,
    sn: selectedDevice,
    from: fromUtc,
    to: toUtc,
    fromUtc,
    toUtc,
    startUtc: fromUtc,
    endUtc: toUtc,
    startDateUtc: fromUtc,
    endDateUtc: toUtc,
  };

  const endpoints = [
    "/api/sensordata/GetRange",
    "/api/sensordata/range",
    "/api/sensordata/GetByRange",
  ];

  for (const endpoint of endpoints) {
    try {
      const rows = await getRows(endpoint, params);
      const points = filterByUtcRange(normalizeRows(rows, selectedDevice), fromUtc, toUtc);
      if (points.length) return points;
    } catch {
      // thử endpoint kế tiếp
    }
  }

  // Không fallback sang GetRecent cho export theo popup.
  // Nếu fallback recent, người dùng chọn 25/06 → 02/07 nhưng BE không có endpoint range
  // thì PDF sẽ lấy "7 ngày gần nhất" và nhìn như xuất sai ngày.
  // Vì vậy range export phải dùng đúng endpoint range; không có thì trả rỗng để báo rõ.
  return [];
}

/** ================= Excel ================= */
export async function exportExcel(args: {
  selectedDevice: string;
  fromUtc: string;
  toUtc: string;
  fromLocal: string;
  toLocal: string;
  rangeText?: string;
  rangeLabel?: string;
  rangeDisplayText?: string;
  rangeDays?: number;
  normalizedRange?: NormalizedExportRange;
}) {
  const { selectedDevice, fromUtc, toUtc, fromLocal, toLocal } = args;
  if (!selectedDevice) return alert("⚠️ Vui lòng chọn thiết bị.");
  if (new Date(fromUtc) >= new Date(toUtc)) {
    return alert("⚠️ 'Từ' phải nhỏ hơn 'Đến'.");
  }

  const response = await api.get("/api/export/excel-by-serial-range", {
    params: {
      serial: selectedDevice,
      serialNumber: selectedDevice,
      deviceId: selectedDevice,
      from: fromUtc,
      to: toUtc,
    },
    responseType: "blob",
    headers: { ...userIdHeader() },
  });

  const blob = new Blob([response.data]);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `LogTag_Report_${safeFilePart(selectedDevice)}_${fromLocal.replace(/[:T]/g, "-")}_${toLocal.replace(/[:T]/g, "-")}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** ================= PDF ================= */
export async function exportPDF({
  selectedDevice,
  liveMode,
  liveWindow,
  fromUtc,
  toUtc,
  fromLocal,
  toLocal,
  chartPanel,
  rangeText,
  rangeLabel,
  rangeDisplayText,
  rangeDays,
  normalizedRange,
}: PdfArgs) {
  if (!selectedDevice) return alert("⚠️ Vui lòng chọn thiết bị.");

  const safeLiveWindow = (["1h", "6h", "24h", "7d"] as string[]).includes(String(liveWindow))
    ? liveWindow
    : ("1h" as LiveWindow);

  // Popup đã gửi LOCAL datetime. Chỉ normalize bằng exportRange.ts,
  // tuyệt đối không tự build lại từ fromUtc/toUtc vì sẽ lệch +07:00 và sai số ngày.
  const normalizedPickedRange = !liveMode
    ? (normalizedRange ?? buildExportRange({ fromLocal, toLocal }))
    : null;

  const exportRange = liveMode
    ? liveRange(safeLiveWindow)
    : { fromUtc: normalizedPickedRange!.fromUtc, toUtc: normalizedPickedRange!.toUtc };

  let points: ExportPoint[] = [];
  try {
    points = liveMode
      ? await fetchRecentPoints(selectedDevice, safeLiveWindow)
      : await fetchRangePoints(selectedDevice, exportRange.fromUtc, exportRange.toUtc);

    points = filterByUtcRange(points, exportRange.fromUtc, exportRange.toUtc);
  } catch (err) {
    console.error("[exportPDF] fetch points failed", err);
  }

  if (!points.length) {
    alert("Không có dữ liệu trong khoảng thời gian đã chọn để xuất PDF. Nếu Excel vẫn có dữ liệu, cần thêm/sửa API JSON range: /api/sensordata/GetRange.");
    return;
  }

  const actualFirst = points[0]?.timestamp ? fmtLocalShort(points[0].timestamp) : "--";
  const actualLast = points[points.length - 1]?.timestamp ? fmtLocalShort(points[points.length - 1].timestamp) : "--";
  console.info("[exportPDF] selected range", {
    serial: selectedDevice,
    rangeText: normalizedPickedRange?.rangeText ?? rangeText,
    selectedFromUtc: exportRange.fromUtc,
    selectedToUtc: exportRange.toUtc,
    selectedFromLocal: normalizedPickedRange?.fromLocal ?? fromLocal,
    selectedToLocal: normalizedPickedRange?.toLocal ?? toLocal,
    actualFirst,
    actualLast,
    rows: points.length,
  });

  const pdfOptions: any = {
    tempThresholds: TEMP_THRESHOLDS,
    humThresholds: HUM_THRESHOLDS,
    logoUrl: "/Pictures/logo.png",
    source: `${selectedDevice}.ltd`,
    intervalLabel: "5m",
    timezoneLabel: "UTC +07:00 PDF Timezone",
    rangeText: normalizedPickedRange?.rangeText ?? rangeText ?? selectedRangeLabel(exportRange.fromUtc, exportRange.toUtc),
    selectedRangeLabel: normalizedPickedRange?.label ?? rangeLabel,
    selectedRangeDisplayText: normalizedPickedRange?.rangeText ?? rangeDisplayText,
    selectedRangeDays: normalizedPickedRange?.days ?? rangeDays,
    selectedFromUtc: exportRange.fromUtc,
    selectedToUtc: exportRange.toUtc,
    selectedFromLocal: normalizedPickedRange?.fromLocal ?? fromLocal,
    selectedToLocal: normalizedPickedRange?.toLocal ?? toLocal,
  };

  // Reuse đúng template PDF đẹp bên User.
  // Tên file sẽ là: LogTag_Report_<SERIAL>_<timestamp>.pdf
  await exportSmartTechPdf(
    chartPanel || document.body,
    selectedDevice,
    liveMode,
    safeLiveWindow,
    Math.max(1, Math.round(((parseMs(exportRange.toUtc) ?? 0) - (parseMs(exportRange.fromUtc) ?? 0)) / 3_600_000)),
    points as any,
    pdfOptions,
  );
}
