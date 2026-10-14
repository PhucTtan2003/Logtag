// src/pages/User/UserChartPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import Chart from "../../components/Chart/Chart";
import api from "../../api/axios";
import "../../styles/User/UserChartPage.css";
import "../../styles/User/UserChartPage.css";

import type { LiveWindow, Point } from "./userchart/types";
import type { DataPoint } from "../../hooks/useSensorChartDataRange";

import { useDeviceList } from "../../hooks/useUserChartDevices";
import { useHistoryData } from "../../hooks/useHistoryData";
import { useLiveReadings } from "../../hooks/useUserChartLive";

import { exportPdf } from "./userchart/exports/exportPdf";
import { exportExcel } from "./userchart/exports/exportExcel";
import RangeExportDialog from "../../components/Export/RangeExportDialog";
import { toUtcIsoForQuery } from "../../utils/time";
import { useAlertThreshold } from "../../hooks/useAlertThreshold";

/* =========================================================
   HELPERS
========================================================= */
const baseSerialOf = (id: string) => id.replace(/-CH\d+$/i, "");
type Grouped = Record<string, string[]>;

type DeviceNameRow = {
  userId?: string;
  teamId: number | string;
  serialNumber: string;
  name?: string | null;
  notes?: string | null;
  assignedAtUtc?: string;
};

type DeviceRenameTarget = {
  displaySerial: string;
  mappingSerial: string;
  teamId: number;
  currentName: string;
};

function normalizeSerial(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeDeviceName(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function getDeviceNameFromRow(row?: DeviceNameRow | null) {
  return normalizeDeviceName(row?.name ?? row?.notes ?? "");
}

function getApiErrorMessage(error: any, fallback: string) {
  const data = error?.response?.data;
  if (typeof data === "string" && data.trim()) return data;
  return data?.message || data?.error || data?.detail || error?.message || fallback;
}

const MAX_CACHE_POINTS = 1500;
const MAX_CHART_POINTS = 650;
const MAX_FULLSCREEN_CHART_POINTS = 1200;
const SELECTED_BASE_STORAGE_KEY = "user-chart:selected-base";

function pointTs(p: Point): number {
  const raw = (p as any)?.timestamp ?? (p as any)?.dateUtc ?? (p as any)?.time;
  const ts = typeof raw === "number" ? raw : new Date(raw).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function normalizePoints(pts: Point[], limit = MAX_CACHE_POINTS): Point[] {
  if (!Array.isArray(pts) || pts.length === 0) return [];

  const map = new Map<number, Point>();

  for (const p of pts) {
    const ts = pointTs(p);
    if (!ts) continue;
    map.set(ts, p);
  }

  return Array.from(map.values())
    .sort((a, b) => pointTs(a) - pointTs(b))
    .slice(-limit);
}

function downsample<T>(rows: T[], max = MAX_CHART_POINTS): T[] {
  if (!Array.isArray(rows) || rows.length <= max) return rows;

  const step = Math.ceil(rows.length / max);
  const picked = rows.filter((_, index) => index % step === 0);
  const last = rows[rows.length - 1];

  if (picked[picked.length - 1] !== last) picked.push(last);
  return picked;
}

function readCachedPoints(cacheKey: string): Point[] {
  try {
    const raw = sessionStorage.getItem(cacheKey);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return normalizePoints(parsed as Point[]);
  } catch {
    return [];
  }
}

function writeCachedPoints(cacheKey: string, pts: Point[]) {
  try {
    sessionStorage.setItem(cacheKey, JSON.stringify(normalizePoints(pts)));
  } catch {
    // Safari private mode / quota đầy: bỏ qua, không làm vỡ UI.
  }
}

function formatTemp(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}°C`;
}

function formatTime(value: string | number | Date | null | undefined) {
  if (value == null || value === "") return "—";

  const d = value instanceof Date ? value : new Date(value);
  const ts = d.getTime();

  if (!Number.isFinite(ts)) return "—";
  return d.toLocaleString();
}

function formatTrend(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || Math.abs(value) < 0.01) return "Ổn định";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}°C`;
}

function toDataPoints(pts: Point[]): DataPoint[] {
  return pts.map((p, i) => {
    const ts = pointTs(p);

    return {
      time: ts,
      label: (p as any).label ?? `Điểm ${i + 1}`,
      temperature: (p as any).temperature ?? 0,
      humidity: (p as any).humidity ?? 0,
    };
  });
}


function pointMillisForExport(p: Point): number {
  const raw = (p as any).timestamp ?? (p as any).time ?? (p as any).dateUtc;
  const ts = typeof raw === "number" ? raw : new Date(raw).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function filterPointsByUtcRange(pts: Point[], fromUtc: string, toUtc: string): Point[] {
  const fromMs = new Date(fromUtc).getTime();
  const toMs = new Date(toUtc).getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) return [];

  return (pts || [])
    .filter((p) => {
      const ts = pointMillisForExport(p);
      // Dùng < toMs để không lố sang ngày kế tiếp khi user chọn hết ngày.
      return ts >= fromMs && ts < toMs;
    })
    .sort((a: Point, b: Point) => pointMillisForExport(a) - pointMillisForExport(b));
}

function localInputMs(value: string): number {
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function isLocalMidnight(value: string): boolean {
  const d = new Date(value);
  return (
    Number.isFinite(d.getTime()) &&
    d.getHours() === 0 &&
    d.getMinutes() === 0 &&
    d.getSeconds() === 0 &&
    d.getMilliseconds() === 0
  );
}


function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toDatetimeLocalValue(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Export PDF theo ngày lịch mà user chọn.
 *
 * Lý do cần hàm này:
 * - Popup preset nhiều ngày có thể trả "Từ" = hiện tại - N ngày, ví dụ 15/06 11:17.
 * - User lại hiểu là chọn trọn các ngày 15, 16, 17.
 * - Nếu query từ 15/06 11:17 thì các điểm sáng/ngày 15 sẽ bị rớt, nhìn như PDF bắt đầu từ 16.
 *
 * Quy tắc:
 * - Range >= 2 ngày: kéo mốc Từ về 00:00 của ngày bắt đầu.
 * - Nếu mốc Đến là 00:00 của một ngày, hiểu là chọn hết ngày đó => đẩy sang 00:00 ngày kế tiếp.
 * - Range ngắn dưới 2 ngày vẫn giữ đúng giờ user chọn để không phá export 24h/6h.
 */
function normalizeExportLocalRange(fromLocal: string, toLocal: string) {
  const from = new Date(fromLocal);
  const to = new Date(toLocal);

  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    return { fromLocal, toLocal };
  }

  let fixedFrom = from;
  let fixedTo = to;

  const diffMs = to.getTime() - from.getTime();
  const isMultiDayRange = diffMs >= 2 * 24 * 60 * 60 * 1000;

  if (isMultiDayRange || isLocalMidnight(fromLocal)) {
    fixedFrom = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 0, 0, 0, 0);
  }

  if (isLocalMidnight(toLocal)) {
    fixedTo = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1, 0, 0, 0, 0);
  }

  return {
    fromLocal: toDatetimeLocalValue(fixedFrom),
    toLocal: toDatetimeLocalValue(fixedTo),
  };
}

function filterPointsByLocalRange(pts: Point[], fromLocal: string, toLocal: string): Point[] {
  const fromMs = localInputMs(fromLocal);
  const toMs = localInputMs(toLocal);
  if (!fromMs || !toMs || fromMs >= toMs) return [];

  return (pts || [])
    .filter((p) => {
      const ts = pointMillisForExport(p);
      return ts >= fromMs && ts < toMs;
    })
    .sort((a: Point, b: Point) => pointMillisForExport(a) - pointMillisForExport(b));
}

function formatLocalMs(ms: number) {
  return new Date(ms).toLocaleString("vi-VN", { hour12: false });
}

function selectedRangeTextFromLocal(fromLocal: string, toLocal: string) {
  const fromMs = localInputMs(fromLocal);
  const toMsRaw = localInputMs(toLocal);
  if (!fromMs || !toMsRaw) return pdfRangeText(toUtcIsoForQuery(fromLocal), toUtcIsoForQuery(toLocal));

  // Nếu input Đến là 00:00 ngày kế tiếp để đại diện hết ngày trước đó,
  // hiển thị 23:59:59 ngày trước để user không thấy bị nhảy sang ngày 30.
  const toDisplayMs = isLocalMidnight(toLocal) ? toMsRaw - 1000 : toMsRaw;
  return `${formatLocalMs(fromMs)} → ${formatLocalMs(toDisplayMs)}`;
}

function selectedRangeLabelFromLocal(fromLocal: string, toLocal: string) {
  const fromMs = localInputMs(fromLocal);
  const toMs = localInputMs(toLocal);
  if (!fromMs || !toMs || fromMs >= toMs) return "Khoảng đã chọn";
  const days = Math.max(1, Math.ceil((toMs - fromMs) / 86_400_000));
  return `Khoảng đã chọn (${days} ngày)`;
}

function pdfRangeText(fromUtc: string, toUtc: string) {
  return `${new Date(fromUtc).toLocaleString("vi-VN", { hour12: false })} → ${new Date(toUtc).toLocaleString("vi-VN", { hour12: false })}`;
}

function pdfPointsRangeText(pts: Point[], fallbackFromUtc: string, fallbackToUtc: string) {
  const times = (pts || [])
    .map(pointMillisForExport)
    .filter((x) => Number.isFinite(x) && x > 0)
    .sort((a, b) => a - b);

  if (!times.length) return pdfRangeText(fallbackFromUtc, fallbackToUtc);

  const first = new Date(times[0]).toLocaleString("vi-VN", { hour12: false });
  const last = new Date(times[times.length - 1]).toLocaleString("vi-VN", { hour12: false });
  return `${first} → ${last}`;
}

function diffDaysForPdf(fromUtc: string, toUtc: string) {
  const fromMs = new Date(fromUtc).getTime();
  const toMs = new Date(toUtc).getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) return 1;
  return (toMs - fromMs) / 86_400_000;
}

function recentWindowFromPdfRange(fromUtc: string, toUtc: string): LiveWindow {
  const days = diffDaysForPdf(fromUtc, toUtc);
  if (days <= 1.2) return "24h";
  if (days <= 7.5) return "7d";
  if (days <= 30.5) return "30d";
  return "62d";
}

function selectedRangeLabel(fromUtc: string, toUtc: string) {
  const days = diffDaysForPdf(fromUtc, toUtc);
  const rounded = Math.max(1, Math.ceil(days));
  return `Khoảng đã chọn (${rounded} ngày)`;
}

function capForRecentWindow(w: LiveWindow) {
  if (w === "1h") return 600;
  if (w === "6h") return 1200;
  if (w === "24h") return 2400;
  if (w === "7d") return 8000;
  if (w === "30d") return 20000;
  return 40000;
}

function normalizeApiPointForPdf(r: any, i: number): Point {
  const raw =
    r?.timestamp ??
    r?.Timestamp ??
    r?.dateUtc ??
    r?.DateUtc ??
    r?.timeUtc ??
    r?.TimeUtc ??
    r?.time ??
    r?.label;

  let ts = 0;
  if (raw instanceof Date) ts = raw.getTime();
  else if (typeof raw === "number" && Number.isFinite(raw)) ts = raw < 10_000_000_000 ? raw * 1000 : raw;
  else if (typeof raw === "string" && raw.trim()) ts = new Date(raw).getTime();

  const safeTime = Number.isFinite(ts) && ts > 0 ? ts : Date.now() + i;

  return {
    ...(r || {}),
    timestamp: safeTime,
    label: r?.label ?? new Date(safeTime).toLocaleString("vi-VN", { hour12: false }),
    temperature: Number(r?.temperature ?? r?.Temperature ?? 0),
    humidity: Number(r?.humidity ?? r?.Humidity ?? 0),
  } as Point;
}

async function tryFetchJsonPoints(url: string, uid: string): Promise<Point[] | null> {
  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    headers: uid ? { "X-User-Id": uid } : undefined,
  });

  // Endpoint không tồn tại / sai contract thì thử route kế tiếp.
  // Một số BE dùng param `serial`, một số dùng `serialNumber`; route sai có thể trả 400.
  if (res.status === 404 || res.status === 405 || res.status === 400) return null;
  if (!res.ok) throw new Error(await res.text());

  const json = await res.json();
  const rows: any[] = Array.isArray(json)
    ? json
    : Array.isArray(json?.data)
    ? json.data
    : Array.isArray(json?.items)
    ? json.items
    : [];

  return rows
    .map((r: any, i: number) => normalizeApiPointForPdf(r, i))
    .sort((a: Point, b: Point) => pointMillisForExport(a) - pointMillisForExport(b));
}

async function fetchRangePointsForPdf(deviceId: string, fromUtc: string, toUtc: string): Promise<Point[]> {
  const apiBase = String(process.env.REACT_APP_API_BASE_URL || "").replace(/\/+$/, "");
  const uid = localStorage.getItem("accountId") || localStorage.getItem("userId") || localStorage.getItem("uid") || "";

  const buildRangeUrl = (path: string) => {
    const qs = new URLSearchParams({
      // Gửi đủ alias để khớp BE hiện tại: lỗi của bạn báo `serial` is required.
      serial: deviceId,
      serialNumber: deviceId,
      deviceId,
      from: fromUtc,
      to: toUtc,
      fromUtc,
      toUtc,
      startUtc: fromUtc,
      endUtc: toUtc,
      startDateUtc: fromUtc,
      endDateUtc: toUtc,
    });
    return `${apiBase}${path}?${qs.toString()}`;
  };

  // Ưu tiên endpoint JSON theo đúng Từ/Đến.
  // BE nên trả array hoặc { data: [...] } với timestamp/dateUtc/temperature/humidity.
  const exactUrls = [
    buildRangeUrl("/api/sensordata/GetRange"),
    buildRangeUrl("/api/sensordata/range"),
    buildRangeUrl("/api/sensordata/GetByRange"),
  ];

  for (const url of exactUrls) {
    const rows = await tryFetchJsonPoints(url, uid);
    if (rows) return filterPointsByUtcRange(rows, fromUtc, toUtc);
  }

  // Fallback cuối: GetRecent chỉ lấy cửa sổ gần nhất, nên BẮT BUỘC filter lại theo Từ/Đến.
  // Nếu chọn ngày cũ không nằm trong recent window thì sẽ trả rỗng, tránh xuất nhầm 7 ngày gần nhất.
  const windowKey = recentWindowFromPdfRange(fromUtc, toUtc);
  const n = capForRecentWindow(windowKey);
  const recentQs = new URLSearchParams({
    serial: deviceId,
    serialNumber: deviceId,
    deviceId,
    window: windowKey,
    n: String(n),
  });
  const recentUrl = `${apiBase}/api/sensordata/GetRecent?${recentQs.toString()}`;

  const recentRows = await tryFetchJsonPoints(recentUrl, uid);
  return filterPointsByUtcRange(recentRows || [], fromUtc, toUtc);
}

function calcStats(data: DataPoint[]) {
  const temps = data
    .map((x) => Number(x.temperature))
    .filter((x) => Number.isFinite(x));

  const latest = data[data.length - 1];
  const previous = data.length > 1 ? data[data.length - 2] : undefined;

  if (temps.length === 0) {
    return {
      latest: null as number | null,
      min: null as number | null,
      max: null as number | null,
      avg: null as number | null,
      trend: null as number | null,
      latestTime: null as number | null,
      points: data.length,
    };
  }

  const sum = temps.reduce((a, b) => a + b, 0);

  return {
    latest: Number(latest?.temperature ?? temps[temps.length - 1]),
    min: Math.min(...temps),
    max: Math.max(...temps),
    avg: sum / temps.length,
    trend:
      latest && previous
        ? Number(latest.temperature ?? 0) - Number(previous.temperature ?? 0)
        : null,
    latestTime: latest?.time ?? null,
    points: data.length,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/* =========================================================
   SMALL UI PARTS
========================================================= */
function LivePulse({ active = true }: { active?: boolean }) {
  return (
    <span className={"uc-live-pulse" + (active ? " is-active" : "")}> 
      <i />
      {active ? "Realtime" : "Offline"}
    </span>
  );
}

function MetricTile({
  icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: string;
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "hot" | "cold" | "good" | "live";
}) {
  return (
    <div className={`uc-metric-tile uc-metric-${tone}`}>
      <div className="uc-metric-icon">{icon}</div>
      <div className="uc-metric-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        {hint && <small>{hint}</small>}
      </div>
    </div>
  );
}

function HistoryTable({ data }: { data: DataPoint[] }) {
  if (!data || data.length === 0) {
    return <div className="history-table-empty">Không có dữ liệu.</div>;
  }

  return (
    <div className="history-table-wrap uc-table-shell">
      <table className="history-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Thời gian</th>
            <th>Nhiệt độ (°C)</th>
          </tr>
        </thead>

        <tbody>
          {data.map((p, i) => (
            <tr key={`${p.time}-${i}`}>
              <td>{i + 1}</td>
              <td>{new Date(p.time).toLocaleString()}</td>
              <td>{Number(p.temperature ?? 0).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ThermalGauge({ latest, min, max }: { latest: number | null; min: number | null; max: number | null }) {
  const display = latest == null || !Number.isFinite(latest) ? "—" : latest.toFixed(1);
  const pct = latest == null || !Number.isFinite(latest) ? 0 : clamp(((latest + 30) / 90) * 100, 0, 100);
  const safeMin = min == null || !Number.isFinite(min) ? "—" : min.toFixed(1);
  const safeMax = max == null || !Number.isFinite(max) ? "—" : max.toFixed(1);
  const style = { "--uc-gauge": `${pct}%` } as React.CSSProperties;

  return (
    <div className="uc-thermal-gauge" style={style}>
      <div className="uc-gauge-ring">
        <div className="uc-gauge-glow" />
        <div className="uc-gauge-core">
          <span>THERMAL</span>
          <strong>{display}</strong>
          <em>°C</em>
        </div>
      </div>
      <div className="uc-gauge-foot">
        <span>Min {safeMin}</span>
        <span>Max {safeMax}</span>
      </div>
    </div>
  );
}

function SignalTape({ data }: { data: DataPoint[] }) {
  const sample = data.slice(-42);
  const temps = sample.map((x) => Number(x.temperature)).filter(Number.isFinite);
  const min = temps.length ? Math.min(...temps) : 0;
  const max = temps.length ? Math.max(...temps) : 1;
  const range = Math.max(max - min, 0.001);

  return (
    <div className="uc-signal-tape" aria-label="Dải tín hiệu nhiệt độ">
      {sample.length === 0 ? (
        <span className="uc-tape-empty">Chưa có tín hiệu</span>
      ) : (
        sample.map((p, index) => {
          const temp = Number(p.temperature);
          const height = Number.isFinite(temp) ? 18 + ((temp - min) / range) * 76 : 18;
          return (
            <i
              key={`${p.time}-${index}`}
              style={{ height: `${height}%` }}
              title={`${new Date(p.time).toLocaleString()} • ${formatTemp(temp)}`}
            />
          );
        })
      )}
    </div>
  );
}

function DataCapsule({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="uc-data-capsule">
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}

function FleetOverview({
  totalDevices,
  totalChannels,
  selectedBase,
  selectedChannels,
  liveWindow,
}: {
  totalDevices: number;
  totalChannels: number;
  selectedBase: string;
  selectedChannels: string[];
  liveWindow: LiveWindow;
}) {
  return (
    <section className="uc-fleet-overview">
      <MetricTile icon="🧊" label="Thiết bị" value={String(totalDevices)} hint="đang được gán" tone="live" />
      <MetricTile icon="📡" label="Kênh dữ liệu" value={String(totalChannels)} hint="toàn bộ hệ thống" />
      <MetricTile icon="🎯" label="Đang xem" value={selectedBase || "—"} hint={`${selectedChannels.length} kênh`} tone="good" />
      <MetricTile icon="⏱" label="Khoảng realtime" value={String(liveWindow).toUpperCase()} hint="chart ưu tiên cache" />
    </section>
  );
}

// function MissionHeader({ selectedBase, liveWindow }: { selectedBase: string; liveWindow: LiveWindow }) {
//   return (
//     <section className="uc-neo-hero ios-card">
//       <div className="uc-neo-noise" />
//       <div className="uc-neo-copy">
//         <div className="uc-hero-kicker">
//           <LivePulse active />
//           <span>Thermal mission room</span>
//         </div>
//         <h1>Không chỉ xem biểu đồ — đây là phòng điều khiển nhiệt độ.</h1>
//         <p>
//           Thiết kế mới tách rõ 3 lớp: chọn thiết bị ở rail trái, điều khiển realtime ở phía trên,
//           và chart trung tâm kiểu telemetry để nhìn tình trạng nhanh hơn khi có nhiều thiết bị.
//         </p>
//       </div>

//       <div className="uc-neo-radar" aria-hidden="true">
//         <span className="uc-radar-sweep" />
//         <span className="uc-radar-core">℃</span>
//         <i className="uc-radar-dot d1" />
//         <i className="uc-radar-dot d2" />
//         <i className="uc-radar-dot d3" />
//       </div>

//       <div className="uc-neo-tags">
//         <DataCapsule label="Focus" value={selectedBase || "—"} sub="serial đang quan sát" />
//         <DataCapsule label="Window" value={String(liveWindow).toUpperCase()} sub="vùng realtime" />
//       </div>
//     </section>
//   );
// }


// function MissionFocusCard({
//   selectedBase,
//   selectedChannels,
//   liveWindow,
//   totalDevices,
//   totalChannels,
// }: {
//   selectedBase: string;
//   selectedChannels: string[];
//   liveWindow: LiveWindow;
//   totalDevices: number;
//   totalChannels: number;
// }) {
//   return (
//     // <section className="uc-left-mission-card ios-card" aria-label="Mission focus">
//     //   <div className="uc-left-mission-glow" />

//     //   <div className="uc-left-mission-top">
//     //     <span>Mission focus</span>
//     //     <LivePulse active />
//     //   </div>

//     //   <div className="uc-left-orbit-wrap">
//     //     <div className="uc-left-orbit" aria-hidden="true">
//     //       <i className="ring r1" />
//     //       <i className="ring r2" />
//     //       <i className="ring r3" />
//     //       <b>℃</b>
//     //     </div>

//     //     <div className="uc-left-focus-copy">
//     //       <small>Đang quan sát</small>
//     //       <strong title={selectedBase || "Chưa chọn"}>{selectedBase || "—"}</strong>
//     //       <em>{selectedChannels.length || 0} kênh • window {String(liveWindow).toUpperCase()}</em>
//     //     </div>
//     //   </div>

//     //   {/* <div className="uc-left-health-grid">
//     //     <div>
//     //       <small>Thiết bị</small>
//     //       <strong>{totalDevices}</strong>
//     //     </div>
//     //     <div>
//     //       <small>Tổng kênh</small>
//     //       <strong>{totalChannels}</strong>
//     //     </div>
//     //     <div>
//     //       <small>Kênh chọn</small>
//     //       <strong>{selectedChannels.length}</strong>
//     //     </div>
//     //     <div>
//     //       <small>Render</small>
//     //       <strong>Lazy</strong>
//     //     </div>
//     //   </div> */}

//     //   <div className="uc-left-flow">
//     //     <span><i />Cache trước</span>
//     //     <span><i />Realtime sau</span>
//     //     <span><i />Không reload chart</span>
//     //   </div>
//     // </section>
//   // );
// }

/* =========================================================
   DEVICE NAME MODAL
========================================================= */
function DeviceNameModal({
  target,
  onClose,
  onSaved,
}: {
  target: DeviceRenameTarget | null;
  onClose: () => void;
  onSaved: (mappingSerial: string, name: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(target?.currentName ?? "");
    setError("");
  }, [target]);

  if (!target) return null;

  const save = async () => {
    const cleaned = normalizeDeviceName(draft);

    if (cleaned.length > 80) {
      setError("Tên thiết bị tối đa 80 ký tự.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      await api.put(
        `/api/device-names/mine/${encodeURIComponent(target.mappingSerial)}`,
        {
          teamId: target.teamId,
          name: cleaned || null,
        },
      );

      onSaved(target.mappingSerial, cleaned);
      onClose();
    } catch (err: any) {
      setError(
        getApiErrorMessage(
          err,
          "Không thể lưu tên thiết bị. Vui lòng thử lại.",
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="uc-device-name-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="uc-device-name-title"
      onMouseDown={(event) => {
        if (!saving && event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className="uc-device-name-modal"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="uc-device-name-modal__head">
          <div className="uc-device-name-modal__icon">🏷️</div>
          <div>
            <span>TÊN GỢI NHỚ THIẾT BỊ</span>
            <h3 id="uc-device-name-title">Đặt tên cho tủ / vị trí</h3>
            <p>
              Tên này sẽ hiển thị cùng mã thiết bị trên biểu đồ, cảnh báo realtime
              và nội dung SMS.
            </p>
          </div>
          <button
            type="button"
            className="uc-device-name-modal__close"
            onClick={onClose}
            disabled={saving}
            aria-label="Đóng"
          >
            ×
          </button>
        </div>

        <div className="uc-device-name-preview">
          <small>Mã thiết bị</small>
          <strong>{target.displaySerial}</strong>
          <span>
            Sau khi lưu: {target.displaySerial}
            {normalizeDeviceName(draft)
              ? ` - ${normalizeDeviceName(draft)}`
              : ""}
          </span>
        </div>

        <label className="uc-device-name-field">
          <span>Tên thiết bị</span>
          <input
            value={draft}
            maxLength={80}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ví dụ: Tủ vaccine A, Kho lạnh số 2..."
          />
          <small>{draft.length}/80 ký tự</small>
        </label>

        {error && <div className="uc-device-name-error">{error}</div>}

        <div className="uc-device-name-actions">
          {target.currentName && (
            <button
              type="button"
              className="uc-device-name-btn uc-device-name-btn--remove"
              disabled={saving}
              onClick={() => setDraft("")}
            >
              Xóa tên
            </button>
          )}

          <span />

          <button
            type="button"
            className="uc-device-name-btn uc-device-name-btn--ghost"
            disabled={saving}
            onClick={onClose}
          >
            Hủy
          </button>

          <button
            type="submit"
            className="uc-device-name-btn uc-device-name-btn--primary"
            disabled={saving}
          >
            {saving ? "Đang lưu..." : "Lưu tên thiết bị"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* =========================================================
   DEVICE PICKER - CONSTELLATION RAIL
========================================================= */
function DevicePicker({
  baseSerials,
  groups,
  selectedBase,
  onSelect,
  deviceNames,
}: {
  baseSerials: string[];
  groups: Grouped;
  selectedBase: string;
  onSelect: (base: string) => void;
  deviceNames: Record<string, string>;
}) {
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(24);

  const normalizedQuery = query.trim().toUpperCase();

  const filtered = useMemo(() => {
    if (!normalizedQuery) return baseSerials;

    return baseSerials.filter((base) => {
      const channels = groups[base] ?? [];
      const deviceName = deviceNames[normalizeSerial(base)] || "";
      return (
        base.toUpperCase().includes(normalizedQuery) ||
        deviceName.toUpperCase().includes(normalizedQuery) ||
        channels.some((ch) => ch.toUpperCase().includes(normalizedQuery))
      );
    });
  }, [baseSerials, deviceNames, groups, normalizedQuery]);

  useEffect(() => {
    setVisibleCount(24);
  }, [normalizedQuery]);

  const selectedChannels = selectedBase ? groups[selectedBase] ?? [] : [];
  const visible = filtered.slice(0, visibleCount);
  const hiddenCount = Math.max(filtered.length - visible.length, 0);

  return (
    <aside className="uc-device-rail ios-card">
      <div className="uc-rail-top">
        <span className="uc-rail-badge">DEVICE MAP</span>
        <h2>Chọn trạm</h2>
        <p>{baseSerials.length} thiết bị • {Object.values(groups).reduce((sum, arr) => sum + arr.length, 0)} kênh</p>
      </div>

      <button
        type="button"
        className="uc-selected-orb-card"
        onClick={() => selectedBase && onSelect(selectedBase)}
        title={selectedBase || "Chọn thiết bị"}
      >
        <span className="uc-selected-orb"><i /></span>
        <span>
          <small>Đang khóa vào</small>
          <strong>{selectedBase || "Chưa chọn"}</strong>
          {selectedBase && deviceNames[normalizeSerial(selectedBase)] && (
            <b className="uc-selected-device-name">
              {deviceNames[normalizeSerial(selectedBase)]}
            </b>
          )}
          <em>{selectedBase ? `${selectedChannels.length} kênh active` : "Chọn serial để bắt đầu"}</em>
        </span>
      </button>

      <label className="uc-rail-search">
        <span>⌕</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm serial..."
          autoComplete="off"
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} aria-label="Xóa tìm kiếm">✕</button>
        )}
      </label>

      <div className="uc-constellation-list">
        {filtered.length === 0 ? (
          <div className="uc-device-empty">Không tìm thấy “{query}”.</div>
        ) : (
          visible.map((base, index) => {
            const channels = groups[base] ?? [];
            const active = selectedBase === base;
            const hotIndex = (index % 5) + 1;

            return (
              <button
                key={base}
                type="button"
                className={"uc-star-device hot-" + hotIndex + (active ? " is-active" : "")}
                onClick={() => onSelect(base)}
                title={base}
                aria-pressed={active}
              >
                <span className="uc-star-node"><i /></span>
                <span className="uc-star-copy">
                  <strong>{base}</strong>
                  {deviceNames[normalizeSerial(base)] && (
                    <em className="uc-star-device-name">
                      {deviceNames[normalizeSerial(base)]}
                    </em>
                  )}
                  <small>{channels.length} kênh telemetry</small>
                </span>
                <b>{active ? "LIVE" : "→"}</b>
              </button>
            );
          })
        )}
      </div>

      {hiddenCount > 0 && (
        <button type="button" className="uc-load-more" onClick={() => setVisibleCount((n) => n + 24)}>
          Mở thêm {Math.min(24, hiddenCount)} thiết bị
        </button>
      )}

      <div className="uc-rail-fill-panel" aria-label="Tóm tắt nhanh khu vực trống">
        <div className="uc-rail-fill-head">
          <span>Mission focus</span>
          <strong>{selectedBase || "—"}</strong>
          {selectedBase && deviceNames[normalizeSerial(selectedBase)] && (
            <em>{deviceNames[normalizeSerial(selectedBase)]}</em>
          )}
          <small>Lấp vùng trái bằng thông tin đang xem, không để rail bị trống khi cuộn xuống chart.</small>
        </div>

        <div className="uc-rail-focus-orbit" aria-hidden="true">
          <i className="ring r1" />
          <i className="ring r2" />
          <i className="ring r3" />
          <b>℃</b>
        </div>

        <div className="uc-rail-health-grid">
          <div>
            <small>Thiết bị</small>
            <strong>{baseSerials.length}</strong>
          </div>
          <div>
            <small>Kênh chọn</small>
            <strong>{selectedChannels.length}</strong>
          </div>
          <div>
            <small>Đang lọc</small>
            <strong>{filtered.length}</strong>
          </div>
          <div>
            <small>Render</small>
            <strong>Lazy</strong>
          </div>
        </div>

        <div className="uc-rail-flow">
          <span><i />Cache trước</span>
          <span><i />Realtime sau</span>
          <span><i />Không reload toàn bộ</span>
        </div>
      </div>
    </aside>
  );
}

/* =========================================================
   1 CHANNEL = 1 PANEL
========================================================= */
function ChannelChart({
  deviceId,
  deviceName,
  onRename,
  liveMode,
  liveWindow,
  histHours,
  forceTable,
}: {
  deviceId: string;
  deviceName?: string;
  onRename: (serial: string) => void;
  liveMode: boolean;
  liveWindow: LiveWindow;
  histHours: number;
  forceTable: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const fullSheetRef = useRef<HTMLDivElement | null>(null);

  const tempThresholds = useAlertThreshold(deviceId);

  const [showTable, setShowTable] = useState(false);
  const [full, setFull] = useState(false);
  const [exportMode, setExportMode] = useState<"excel" | "pdf" | null>(null);
  const [cachedPoints, setCachedPoints] = useState<Point[]>([]);

  const cacheKey = useMemo(() => {
    const modeKey = liveMode ? `live:${liveWindow}` : `history:${histHours}h`;
    return `user-chart:${deviceId}:${modeKey}`;
  }, [deviceId, histHours, liveMode, liveWindow]);

  useEffect(() => {
    setCachedPoints(readCachedPoints(cacheKey));
  }, [cacheKey]);

  const { histData, loading: loadingHist } = useHistoryData(
    !liveMode ? deviceId : null,
    histHours,
    liveMode
  );

  const {
    liveData,
    latencyMs,
    loading: loadingLive,
    liveUnavailable,
  } = useLiveReadings(deviceId, liveWindow, liveMode);

  const loading = liveMode ? loadingLive : loadingHist;

  const freshPoints: Point[] = useMemo(
    () => normalizePoints(liveMode ? liveData : histData),
    [liveMode, liveData, histData]
  );

  useEffect(() => {
    if (!freshPoints.length) return;

    setCachedPoints(freshPoints);
    writeCachedPoints(cacheKey, freshPoints);
  }, [cacheKey, freshPoints]);

  const points: Point[] = useMemo(() => {
    if (freshPoints.length > 0) return freshPoints;
    return cachedPoints;
  }, [cachedPoints, freshPoints]);

  const data: DataPoint[] = useMemo(() => toDataPoints(points), [points]);

  const chartData: DataPoint[] = useMemo(
    () => downsample(data, MAX_CHART_POINTS),
    [data]
  );

  const fullscreenChartData: DataPoint[] = useMemo(
    () => downsample(data, MAX_FULLSCREEN_CHART_POINTS),
    [data]
  );

  const stats = useMemo(() => calcStats(data), [data]);

  const latencyLabel = liveUnavailable
    ? "Realtime lỗi"
    : latencyMs != null
    ? `${latencyMs} ms`
    : "đang chờ";

  const effectiveShowTable = !liveMode && (forceTable || showTable);
  const hasData = data.length > 0;
  const hardLoading = loading && !hasData;
  const softLoading = loading && hasData;

  const enterFullscreen = async () => setFull(true);
  const exitFullscreen = async () => setFull(false);

  const onExportPdf = () => {
    if (!wrapRef.current || data.length === 0) return;
    setExportMode("pdf");
  };

  const onExportRangeConfirm = async (pickedFromLocal: string, pickedToLocal: string) => {
    const { fromLocal, toLocal } = normalizeExportLocalRange(pickedFromLocal, pickedToLocal);
    const fromUtc = toUtcIsoForQuery(fromLocal);
    const toUtc = toUtcIsoForQuery(toLocal);

    if (exportMode === "excel") {
      exportExcel(deviceId, fromUtc, toUtc);
      setExportMode(null);
      return;
    }

    try {
      // PDF không lấy theo window đang xem ngoài màn hình nữa.
      // Ví dụ ngoài đang chọn 24h nhưng popup chọn 7 ngày => fetch lại 7d từ BE để xuất PDF.
      let pdfPoints = await fetchRangePointsForPdf(deviceId, fromUtc, toUtc);

      // Chốt lại lần cuối bằng đúng mốc user chọn trong popup.
      // Fix case chọn 28 → 29 nhưng PDF bị dính điểm 00:xx ngày 30.
      pdfPoints = filterPointsByLocalRange(pdfPoints, fromLocal, toLocal);

      // Nếu BE không trả được range lớn thì mới fallback lọc data đang có trên màn hình.
      if (pdfPoints.length === 0) {
        pdfPoints = filterPointsByLocalRange(points, fromLocal, toLocal);
      }

      if (pdfPoints.length === 0) {
        alert("Không có dữ liệu trong khoảng thời gian đã chọn để xuất PDF.");
        return;
      }

      const rangeText = `Dữ liệu xuất: ${selectedRangeLabelFromLocal(fromLocal, toLocal)} • ${selectedRangeTextFromLocal(fromLocal, toLocal)}`;

      exportPdf(wrapRef.current!, deviceId, false, liveWindow, histHours, pdfPoints, {
        tempThresholds,
        rangeText,
      });
      setExportMode(null);
    } catch (err: any) {
      console.error("Export PDF range failed:", err);
      alert(err?.message || "Xuất PDF thất bại.");
    }
  };

  useEffect(() => {
    if (!full) return;

    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";

    const tryLockLandscape = async () => {
      try {
        // @ts-ignore
        // eslint-disable-next-line no-restricted-globals
        if (screen?.orientation?.lock) {
          // @ts-ignore
          // eslint-disable-next-line no-restricted-globals
          await screen.orientation.lock("landscape");
        }
      } catch {
        // iOS Safari thường không cho lock orientation.
      }
    };

    const tryRequestFullscreen = async () => {
      try {
        const el = fullSheetRef.current;
        if (!el) return;

        const anyEl = el as any;

        if (anyEl.requestFullscreen) await anyEl.requestFullscreen();
        else if (anyEl.webkitRequestFullscreen) await anyEl.webkitRequestFullscreen();
      } catch {
        // Bỏ qua nếu trình duyệt không hỗ trợ fullscreen.
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFull(false);
    };

    window.addEventListener("keydown", onKey);

    (async () => {
      await tryRequestFullscreen();
      await tryLockLandscape();
    })();

    return () => {
      window.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = prevOverflow;

      try {
        // @ts-ignore
        // eslint-disable-next-line no-restricted-globals
        screen?.orientation?.unlock?.();
      } catch {}

      try {
        const d: any = document;

        if (document.fullscreenElement) document.exitFullscreen();
        else if (d.webkitFullscreenElement && d.webkitExitFullscreen) d.webkitExitFullscreen();
      } catch {}
    };
  }, [full]);

  useEffect(() => {
    const triggerResize = () => {
      window.dispatchEvent(new Event("resize"));
    };

    const frame = window.requestAnimationFrame(triggerResize);
    const timerFast = window.setTimeout(triggerResize, 80);
    const timerStable = window.setTimeout(triggerResize, 260);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timerFast);
      window.clearTimeout(timerStable);
    };
  }, [full]);

  const loadingHint = liveMode
    ? "Vui Lòng Đợi Ít Phút Để Hệ Thống Tải Dữ Liệu."
    : "Đang tải dữ liệu biểu đồ theo khoảng thời gian đã chọn.";

  const ChartLoadingOverlay = ({ compact = false }: { compact?: boolean }) => (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 10,
        display: "grid",
        placeItems: "center",
        background: compact
          ? "rgba(248,250,252,0.52)"
          : "linear-gradient(180deg, rgba(248,250,252,0.82), rgba(239,246,255,0.72))",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        borderRadius: 24,
      }}
    >
      <div
        style={{
          maxWidth: 460,
          padding: compact ? "12px 16px" : "16px 20px",
          borderRadius: 20,
          border: "1px solid rgba(148,163,184,0.28)",
          background: "rgba(255,255,255,0.92)",
          boxShadow: "0 18px 45px rgba(15,23,42,0.14)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          color: "#334155",
          fontWeight: 850,
          textAlign: "left",
        }}
      >
        <span
          style={{
            width: 34,
            height: 34,
            borderRadius: 999,
            display: "grid",
            placeItems: "center",
            background: "linear-gradient(135deg, #22c55e, #06b6d4)",
            color: "#fff",
            boxShadow: "0 10px 22px rgba(6,182,212,0.28)",
            flexShrink: 0,
          }}
        >
          ⏳
        </span>
        <span style={{ lineHeight: 1.35 }}>{loadingHint}</span>
      </div>
    </div>
  );

  return (
    <div className="chart-panel uc-channel-panel uc-telemetry-panel ios-card" ref={wrapRef}>
      <div className="uc-telemetry-grid-bg" />

      <div className="uc-channel-topbar">
        <div className="uc-channel-identity">
          <span className="uc-channel-ring">℃</span>
          <div className="uc-channel-title-block">
            <p>Live telemetry channel</p>
            <div className="uc-channel-title-row">
              <h3 title={deviceName ? `${deviceId} - ${deviceName}` : deviceId}>
                <span>{deviceId}</span>
                {deviceName && <em> - {deviceName}</em>}
              </h3>
              <button
                type="button"
                className="uc-rename-device-btn"
                onClick={() => onRename(deviceId)}
                title={deviceName ? "Đổi tên thiết bị" : "Đặt tên thiết bị"}
              >
                <span aria-hidden="true">✎</span>
                {deviceName ? "Đổi tên" : "Đặt tên"}
              </button>
            </div>
          </div>
        </div>

        <div className="uc-channel-status">
          {liveMode && <LivePulse active={!liveUnavailable} />}
          <span className={"uc-latency" + (liveUnavailable ? " is-error" : "")}>⏱ {latencyLabel}</span>
          {softLoading && <span className="uc-latency is-syncing">Đang đồng bộ...</span>}
        </div>
      </div>

      <div className="uc-telemetry-main uc-telemetry-main--mixed">
        <main className="uc-telemetry-chart-zone">
          <section className="uc-telemetry-mixed-strip" aria-label="Telemetry summary">
            <div className="uc-mixed-gauge-cell">
              <ThermalGauge latest={stats.latest} min={stats.min} max={stats.max} />
            </div>

            <div className="uc-mixed-metrics-cell">
              <div className="uc-channel-metrics uc-floating-metrics uc-mixed-metrics">
                <MetricTile icon="🌡" label="Mới nhất" value={formatTemp(stats.latest)} hint={formatTime(stats.latestTime)} tone="hot" />
                <MetricTile icon="🧮" label="Trung bình" value={formatTemp(stats.avg)} hint="trong vùng đang xem" tone="good" />
                <MetricTile icon="📉" label="Thấp nhất" value={formatTemp(stats.min)} hint="trong khoảng đang xem" tone="cold" />
                <MetricTile icon="📈" label="Cao nhất" value={formatTemp(stats.max)} hint="trong khoảng đang xem" tone="hot" />
                <MetricTile icon="〽️" label="Xu hướng" value={formatTrend(stats.trend)} hint={`${stats.points} điểm dữ liệu`} tone="good" />
              </div>
            </div>

            {/* <div className="uc-mixed-signal-cell">
              <div className="uc-mini-signal-card">
                <div>
                  <span>Signal tape</span>
                  <small>{chartData.length}/{data.length} điểm chart</small>
                </div>
                <SignalTape data={data} />
              </div>
            </div> */}
          </section>

          <div className="uc-chart-toolbar">
            <div className="uc-chart-note">
              <span>Render mượt: {chartData.length}/{data.length} điểm</span>
              <span>•</span>
              <span>Cache trước, realtime sau</span>
            </div>

            <div className="uc-chart-actions">
              <button className="btn btn-ghost ios-btn uc-action-btn" onClick={enterFullscreen} disabled={data.length === 0 || hardLoading}>
                ⛶ Full
              </button>

              {!liveMode && !forceTable && data.length > 0 && (
                <button className="btn btn-ghost ios-btn uc-action-btn" onClick={() => setShowTable((s) => !s)}>
                  {effectiveShowTable ? "📈 Biểu đồ" : "📋 Bảng"}
                </button>
              )}

              <button className="btn btn-ghost ios-btn uc-action-btn" onClick={onExportPdf} disabled={data.length === 0 || hardLoading}>
                🧾 PDF
              </button>

              <button className="btn btn-primary ios-btn uc-action-btn uc-excel-btn" onClick={() => setExportMode("excel")} disabled={hardLoading}>
                📊 Excel
              </button>
            </div>
          </div>

          {hardLoading && (
            <div
              className="chart-viewport ios-chart-surface uc-chart-surface uc-hologram-surface"
              style={{
                position: "relative",
                minHeight: 420,
                overflow: "hidden",
                opacity: 0.92,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 24,
                  background:
                    "radial-gradient(circle at 18% 8%, rgba(34,197,94,0.12), transparent 28%), linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
                  filter: "blur(1.5px)",
                }}
              />
              <ChartLoadingOverlay />
            </div>
          )}

          {!hardLoading && data.length > 0 && (
            <>
              {liveMode ? (
                <div
                  className="chart-viewport ios-chart-surface uc-chart-surface uc-hologram-surface"
                  style={{
                    position: "relative",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div
                    className="uc-chart-inner"
                    style={{
                      width: "100%",
                      height: "100%",
                      minHeight: 0,
                      flex: "1 1 auto",
                      display: "flex",
                      transition: "filter 220ms ease, opacity 220ms ease",
                      filter: softLoading ? "blur(3px)" : "none",
                      opacity: softLoading ? 0.42 : 1,
                      pointerEvents: softLoading ? "none" : "auto",
                    }}
                  >
                    <Chart
                      data={chartData}
                      tempThresholds={tempThresholds}
                    />
                  </div>
                  {softLoading && <ChartLoadingOverlay compact />}
                </div>
              ) : effectiveShowTable ? (
                <div style={{ position: "relative" }}>
                  <div
                    style={{
                      transition: "filter 220ms ease, opacity 220ms ease",
                      filter: softLoading ? "blur(3px)" : "none",
                      opacity: softLoading ? 0.42 : 1,
                      pointerEvents: softLoading ? "none" : "auto",
                    }}
                  >
                    <HistoryTable data={data} />
                  </div>
                  {softLoading && <ChartLoadingOverlay compact />}
                </div>
              ) : (
                <div
                  className="chart-viewport ios-chart-surface uc-chart-surface uc-hologram-surface"
                  style={{
                    position: "relative",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div
                    className="uc-chart-inner"
                    style={{
                      width: "100%",
                      height: "100%",
                      minHeight: 0,
                      flex: "1 1 auto",
                      display: "flex",
                      transition: "filter 220ms ease, opacity 220ms ease",
                      filter: softLoading ? "blur(3px)" : "none",
                      opacity: softLoading ? 0.42 : 1,
                      pointerEvents: softLoading ? "none" : "auto",
                    }}
                  >
                    <Chart
                      data={chartData}
                      tempThresholds={tempThresholds}
                    />
                  </div>
                  {softLoading && <ChartLoadingOverlay compact />}
                </div>
              )}
            </>
          )}

          {!hardLoading && data.length === 0 && (
            <div className="chart-empty uc-empty-chart">
              <span>⌁</span>
              <strong>Không có dữ liệu trong khoảng này.</strong>
           
            </div>
          )}
        </main>
      </div>
      {full && (
        <div className="chart-fullscreen uc-chart-fullscreen" role="dialog" aria-modal="true">
          <div className="chart-fullscreen__backdrop" onClick={exitFullscreen} />

          <div className="chart-fullscreen__sheet" ref={fullSheetRef}>
            <div className="chart-fullscreen__top">
              <div className="chart-fullscreen__title">
                {deviceId}{deviceName ? ` - ${deviceName}` : ""} {liveMode ? "• Realtime" : `• Lịch sử (${histHours}h)`}
              </div>

              <button className="chart-fullscreen__close" onClick={exitFullscreen} aria-label="Đóng" title="Đóng">
                ✕
              </button>
            </div>

            <div className="chart-fullscreen__body">
              {hardLoading ? (
                <div className="chart-loading" style={{ padding: 12 }}>
                  <div className="spinner" /> Đang tải dữ liệu...
                </div>
              ) : data.length === 0 ? (
                <div className="chart-empty" style={{ padding: 12 }}>
                  Không có dữ liệu trong khoảng này.
                </div>
              ) : (
                <div className="chart-fullscreen__viewport">
                  <Chart data={fullscreenChartData} tempThresholds={tempThresholds} isFullscreen height="100%" showBrush />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {exportMode && (
        <RangeExportDialog
          open={!!exportMode}
          serial={deviceId}
          onClose={() => setExportMode(null)}
          onConfirm={onExportRangeConfirm}
        />
      )}
    </div>
  );
}

/* =========================================================
   1 DEVICE = N CHANNELS
========================================================= */
function DevicePanel({
  baseSerial,
  channels,
  deviceNames,
  onRename,
  liveMode,
  liveWindow,
  histHours,
  forceTable,
}: {
  baseSerial: string;
  channels: string[];
  deviceNames: Record<string, string>;
  onRename: (serial: string) => void;
  liveMode: boolean;
  liveWindow: LiveWindow;
  histHours: number;
  forceTable: boolean;
}) {
  const [selectedChannel, setSelectedChannel] = useState<string>("");

  useEffect(() => {
    if (!channels || channels.length === 0) {
      setSelectedChannel("");
      return;
    }

    if (!selectedChannel || !channels.includes(selectedChannel)) {
      setSelectedChannel(channels[0]);
    }
  }, [channels, selectedChannel]);

  return (
    <section className="uc-device-workbench uc-mission-board ios-card">
    

      {channels.length > 1 && (
        <div className="uc-channel-switcher uc-channel-dock">
          <div className="uc-channel-switcher-head">
            <span>Channel dock</span>
            <small>{selectedChannel || "—"}</small>
          </div>

          <div className="uc-channel-tabs">
            {channels.map((ch) => {
              const active = selectedChannel === ch;
              const chName = ch.match(/-CH\d+$/i)?.[0]?.replace("-", "") ?? ch;

              return (
                <button
                  key={ch}
                  type="button"
                  className={"uc-channel-tab" + (active ? " is-active" : "")}
                  onClick={() => setSelectedChannel(ch)}
                  title={ch}
                  aria-pressed={active}
                >
                  <i />
                  <span>
                    <strong>{chName}</strong>
                    <small>
                      {ch}
                      {(deviceNames[normalizeSerial(ch)] ||
                        deviceNames[normalizeSerial(baseSerial)]) &&
                        ` - ${
                          deviceNames[normalizeSerial(ch)] ||
                          deviceNames[normalizeSerial(baseSerial)]
                        }`}
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="uc-channel-stack">
        {selectedChannel && (
          <ChannelChart
            key={selectedChannel}
            deviceId={selectedChannel}
            deviceName={
              deviceNames[normalizeSerial(selectedChannel)] ||
              deviceNames[normalizeSerial(baseSerial)] ||
              ""
            }
            onRename={onRename}
            liveMode={liveMode}
            liveWindow={liveWindow}
            histHours={histHours}
            forceTable={forceTable}
          />
        )}
      </div>
    </section>
  );
}

function ControlStudio({
  liveMode,
  liveWindow,
  setLiveWindow,
  histHours,
  setHistHours,
}: {
  liveMode: boolean;
  liveWindow: LiveWindow;
  setLiveWindow: (w: LiveWindow) => void;
  histHours: number;
  setHistHours: (h: number) => void;
}) {
  const liveWindows = [
    { value: "1h", label: "1 giờ"},
    { value: "6h", label: "6 giờ"},
    { value: "24h", label: "24 giờ"},
    { value: "7d", label: "7 ngày"},
  ];

  const histOptions = [
    { value: 1, label: "1 giờ gần nhất" },
    { value: 6, label: "6 giờ gần nhất" },
    { value: 24, label: "24 giờ gần nhất" },
    { value: 24 * 7, label: "7 ngày gần nhất" },
  ];

  return (
    <section className="uc-control-studio uc-control-strip ios-card">
      <div className="uc-mode-card">
        <span className="uc-mode-icon">⚡</span>
        <div>
          <small>Chế độ</small>
          <strong>Realtime cockpit</strong>
          <em>Điểm mới append vào chart, không reload toàn bộ</em>
        </div>
      </div>

      <div className="uc-window-panel">
        <div className="uc-window-head">
          <span>{liveMode ? "Time lens" : "Khoảng lịch sử"}</span>
          <small>Khoảng ngắn = cảm giác realtime nhanh hơn</small>
        </div>

        <div className="uc-window-tabs">
          {liveMode
            ? liveWindows.map((w) => (
                <button
                  key={w.value}
                  type="button"
                  className={"uc-window-tab" + (liveWindow === w.value ? " is-active" : "")}
                  onClick={() => setLiveWindow(w.value as LiveWindow)}
                >
                  <strong>{w.label}</strong>
                 
                </button>
              ))
            : histOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={"uc-window-tab" + (histHours === opt.value ? " is-active" : "")}
                  onClick={() => setHistHours(opt.value)}
                >
                  <strong>{opt.label}</strong>
                </button>
              ))}
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   MAIN PAGE
========================================================= */
export default function UserChartPage() {
  const { deviceIds, usingPublicList } = useDeviceList();

  const [liveMode] = useState(true);
  const [liveWindow, setLiveWindow] = useState<LiveWindow>("1h");
  const [histHours, setHistHours] = useState(6);
  const [forceTable] = useState(false);

  const [deviceNameRows, setDeviceNameRows] = useState<DeviceNameRow[]>([]);
  const [renameTarget, setRenameTarget] = useState<DeviceRenameTarget | null>(null);

  const [selectedBase, setSelectedBaseState] = useState<string>(() => {
    try {
      return localStorage.getItem(SELECTED_BASE_STORAGE_KEY) || "";
    } catch {
      return "";
    }
  });

  const setSelectedBase = (base: string) => {
    setSelectedBaseState(base);
    try {
      if (base) localStorage.setItem(SELECTED_BASE_STORAGE_KEY, base);
      else localStorage.removeItem(SELECTED_BASE_STORAGE_KEY);
    } catch {
      // Bỏ qua nếu trình duyệt không cho ghi localStorage.
    }
  };

  useEffect(() => {
    let disposed = false;

    api
      .get("/api/device-names/mine")
      .then((response) => {
        if (disposed) return;
        const rows = Array.isArray(response.data) ? response.data : [];
        setDeviceNameRows(
          rows
            .map((row: any) => ({
              userId: row?.userId ? String(row.userId) : undefined,
              teamId: row?.teamId,
              serialNumber: normalizeSerial(row?.serialNumber),
              name: row?.name ?? row?.notes ?? null,
              notes: row?.notes ?? row?.name ?? null,
              assignedAtUtc: row?.assignedAtUtc,
            }))
            .filter(
              (row: DeviceNameRow) =>
                normalizeSerial(row.serialNumber) && Number(row.teamId) > 0,
            ),
        );
      })
      .catch((error) => {
        if (!disposed) {
          console.warn("[DeviceName] Không tải được tên thiết bị:", error);
          setDeviceNameRows([]);
        }
      });

    return () => {
      disposed = true;
    };
  }, []);

  const deviceNameRowBySerial = useMemo(() => {
    const map: Record<string, DeviceNameRow> = {};

    for (const row of deviceNameRows) {
      const key = normalizeSerial(row.serialNumber);
      if (key) map[key] = row;
    }

    return map;
  }, [deviceNameRows]);

  const deviceNames = useMemo(() => {
    const map: Record<string, string> = {};

    for (const row of deviceNameRows) {
      const key = normalizeSerial(row.serialNumber);
      const name = getDeviceNameFromRow(row);
      if (key && name) map[key] = name;
    }

    return map;
  }, [deviceNameRows]);

  const findDeviceNameRow = (serial: string) => {
    const exact = normalizeSerial(serial);
    const base = normalizeSerial(baseSerialOf(exact));
    return deviceNameRowBySerial[exact] || deviceNameRowBySerial[base] || null;
  };

  const openRenameDevice = (serial: string) => {
    const row = findDeviceNameRow(serial);

    if (!row) {
      window.alert(
        "Không tìm thấy mapping của thiết bị trong tài khoản. Vui lòng liên hệ Admin để gán thiết bị trước khi đặt tên.",
      );
      return;
    }

    const teamId = Number(row.teamId);
    if (!Number.isFinite(teamId) || teamId <= 0) {
      window.alert("Team ID của thiết bị không hợp lệ.");
      return;
    }

    setRenameTarget({
      displaySerial: normalizeSerial(serial),
      mappingSerial: normalizeSerial(row.serialNumber),
      teamId,
      currentName: getDeviceNameFromRow(row),
    });
  };

  const handleDeviceNameSaved = (mappingSerial: string, name: string) => {
    const key = normalizeSerial(mappingSerial);

    setDeviceNameRows((prev) =>
      prev.map((row) =>
        normalizeSerial(row.serialNumber) === key
          ? { ...row, name, notes: name }
          : row,
      ),
    );
  };

  const groups: Grouped = useMemo(() => {
    const g: Grouped = {};

    for (const id of deviceIds) {
      const base = baseSerialOf(id);
      (g[base] ||= []).push(id);
    }

    for (const k of Object.keys(g)) {
      g[k].sort((a, b) => {
        const ma = a.match(/-CH(\d+)$/i)?.[1];
        const mb = b.match(/-CH(\d+)$/i)?.[1];

        return (ma ? +ma : 0) - (mb ? +mb : 0);
      });
    }

    return g;
  }, [deviceIds]);

  const baseSerials = useMemo(() => Object.keys(groups), [groups]);
  const selectedChannels = selectedBase ? groups[selectedBase] ?? [] : [];
  const totalChannels = useMemo(
    () => Object.values(groups).reduce((sum, arr) => sum + arr.length, 0),
    [groups]
  );

  useEffect(() => {
    if (baseSerials.length === 0) {
      if (selectedBase) setSelectedBase("");
      return;
    }

    if (!selectedBase || !baseSerials.includes(selectedBase)) {
      setSelectedBase(baseSerials[0]);
    }

  }, [baseSerials, selectedBase]);

  return (
    <div className="user-chart-page-root uc-page-root uc-neo-page">
      <div className="user-chart-container uc-container uc-neo-container">
        {/* <MissionHeader selectedBase={selectedBase} liveWindow={liveWindow} /> */}

        {usingPublicList && (
          <div className="hint ios-hint uc-public-hint">
            🔎 Không tìm thấy thiết bị thuộc tài khoản — đang hiển thị danh sách thiết bị Active để bạn chọn thử.
          </div>
        )}

        <div className="uc-monitor-toolbar ios-card">
          <label className="uc-monitor-select-wrap">
            <span>THIẾT BỊ GIÁM SÁT</span>
            <select value={selectedBase} onChange={(e) => setSelectedBase(e.target.value)} aria-label="Chọn thiết bị">
              {baseSerials.map((serial) => (
                <option key={serial} value={serial}>
                  {deviceNames[normalizeSerial(serial)] ? `${deviceNames[normalizeSerial(serial)]} — ${serial}` : serial}
                </option>
              ))}
            </select>
            <small>{baseSerials.length} thiết bị · {totalChannels} kênh</small>
          </label>
          <ControlStudio
            liveMode={liveMode}
            liveWindow={liveWindow}
            setLiveWindow={setLiveWindow}
            histHours={histHours}
            setHistHours={setHistHours}
          />
        </div>

        {baseSerials.length > 0 ? (
          <div className="uc-monitor-chart">
            {selectedBase && selectedChannels.length > 0 && (
              <DevicePanel
                key={selectedBase}
                baseSerial={selectedBase}
                channels={selectedChannels}
                deviceNames={deviceNames}
                onRename={openRenameDevice}
                liveMode={liveMode}
                liveWindow={liveWindow}
                histHours={histHours}
                forceTable={forceTable}
              />
            )}
          </div>
        ) : (
          <div className="no-device-state uc-no-device ios-card">
            <span>🛰</span>
            <p className="no-device-title">Bạn chưa sở hữu thiết bị nào.</p>
            <p className="no-device-subtitle">Hãy gán thiết bị vào tài khoản để xem biểu đồ.</p>
          </div>
        )}
      </div>

      <DeviceNameModal
        target={renameTarget}
        onClose={() => setRenameTarget(null)}
        onSaved={handleDeviceNameSaved}
      />
    </div>
  );
}