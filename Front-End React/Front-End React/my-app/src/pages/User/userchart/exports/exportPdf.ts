// src/pages/User/userchart/exports/exportPdf.ts
import { jsPDF } from "jspdf";
import type { LiveWindow, Point } from "../types";

type Thresholds = {
  min?: number | null;
  max?: number | null;
};

type ReportEvent = {
  ts?: number | string | Date | null;
  time?: number | string | Date | null;
  event?: string | null;
  label?: string | null;
};

type AlarmRowInput = {
  alarm: string;
  allowedTime?: string;
  totalTime?: string;
  occurrences?: string | number;
  degreeMinutes?: string | number;
  status?: string;
};

type ExportPdfOptions = {
  tempThresholds?: Thresholds;
  humThresholds?: Thresholds;
  logoUrl?: string;
  /** Text hiển thị trên PDF khi xuất theo popup Từ/Đến */
  rangeText?: string;
  /** Mốc range người dùng chọn, dùng để cố định trục X của chart PDF. */
  selectedFromUtc?: string | number | Date;
  selectedToUtc?: string | number | Date;
  /** Nếu caller có sẵn local datetime từ popup thì truyền vào để PDF hiển thị đúng tuyệt đối. */
  selectedFromLocal?: string | number | Date;
  selectedToLocal?: string | number | Date;

  /** Các thông tin giống PDF LogTag Analyzer. Nếu không truyền thì file vẫn tự fill từ points. */
  description?: string;
  model?: string;
  battery?: string;
  tripNumber?: string | number;
  startType?: string;
  startDelay?: string;
  intervalLabel?: string;
  timezoneLabel?: string;
  source?: string;
  fileLocation?: string;
  downloadedAt?: string | number | Date;
  createdAt?: string | number | Date;
  channelLabel?: string;
  serialLabel?: string;
  mktDeltaH?: number;

  /** Nếu BE có event riêng thì truyền vào đây. Nếu không, exportPdf sẽ lấy từ point.events/event/eventType nếu có. */
  events?: ReportEvent[];
  /** Nếu muốn dùng đúng alarm rows từ BE/LogTag thì truyền vào đây. Nếu không, file tự tính từ ngưỡng. */
  upperAlarms?: AlarmRowInput[];
  lowerAlarms?: AlarmRowInput[];
};

type CleanPoint = {
  ts: number;
  temperature: number;
  humidity: number | null;
  eventText: string;
  label?: string;
};

type StatBlock = {
  firstTs: number | null;
  lastTs: number | null;
  elapsedMs: number;
  totalReadings: number;
  evaluatedReadings: number;
  minT: number | null;
  minTs: number | null;
  maxT: number | null;
  maxTs: number | null;
  avgT: number | null;
  stdT: number | null;
  mktT: number | null;
  minH: number | null;
  maxH: number | null;
};

type AlarmCalc = {
  alarm: string;
  allowedTime: string;
  totalMinutes: number;
  occurrences: number;
  degreeMinutes: number;
  status: "OK" | "Fail";
};

type EventInfo = {
  ts: number;
  event: string;
};

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const fmt1 = (v?: number | null, suffix = "") =>
  isFiniteNumber(v) ? `${v.toFixed(1)}${suffix}` : `--${suffix}`;

const fmt2 = (v?: number | null, suffix = "") =>
  isFiniteNumber(v) ? `${v.toFixed(2)}${suffix}` : `--${suffix}`;

const fmt0 = (v?: number | null, suffix = "") =>
  isFiniteNumber(v) ? `${v.toFixed(0)}${suffix}` : `--${suffix}`;

const fmtNum = (v?: number | null) =>
  isFiniteNumber(v) ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "--";

const safeFilePart = (value: string) =>
  String(value || "report")
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, "_")
    .slice(0, 90);

const getTs = (p: any): number => {
  const raw = p?.timestamp ?? p?.time ?? p?.dateUtc ?? p?.DateUtc ?? p?.createdAt ?? p?.label;
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === "number") return raw;
  const d = new Date(raw).getTime();
  return Number.isFinite(d) ? d : Date.now();
};

const getOptionalTs = (raw: any): number | null => {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date) {
    const t = raw.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof raw === "number") {
    const t = raw < 10_000_000_000 ? raw * 1000 : raw;
    return Number.isFinite(t) ? t : null;
  }
  const t = new Date(String(raw)).getTime();
  return Number.isFinite(t) ? t : null;
};

const normalizeEventText = (raw: any) => {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const parts: string[] = [];
  if (/\bX\b|sensor disconnected/i.test(s)) parts.push("Sensor Disconnected");
  if (/\bI\b|inspection/i.test(s)) parts.push("Inspection");
  if (/\bD\b|download/i.test(s)) parts.push("Download");
  if (parts.length) return Array.from(new Set(parts)).join(", ");
  return s;
};

const eventCode = (eventText: string) => {
  const s = String(eventText || "");
  const codes: string[] = [];
  if (/sensor disconnected|\bX\b/i.test(s)) codes.push("X");
  if (/inspection|\bI\b/i.test(s)) codes.push("I");
  if (/download|\bD\b/i.test(s)) codes.push("D");
  return codes.length ? codes.join(" ") : s;
};

const normalizePoints = (points: Point[]): CleanPoint[] =>
  (points || [])
    .map((p: any) => {
      const temp = p.temperature ?? p.Temperature;
      const hum = p.humidity ?? p.Humidity;
      const ev = p.events ?? p.event ?? p.eventType ?? p.Event ?? p.marker ?? "";
      return {
        ts: getTs(p),
        temperature: Number(temp),
        humidity: hum == null ? null : Number(hum),
        eventText: normalizeEventText(ev),
        label: p.label,
      };
    })
    .filter((p) => Number.isFinite(p.ts) && Number.isFinite(p.temperature))
    .sort((a, b) => a.ts - b.ts);

const loadImage = (src: string): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

const roundRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) => {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
};

const fillRoundRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
) => {
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
};

const strokeRoundRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  stroke: string,
  lineWidth = 1,
) => {
  roundRect(ctx, x, y, w, h, r);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
};

const drawText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  color: string,
  maxWidth?: number,
) => {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(String(text ?? ""), x, y, maxWidth);
};

const ellipsize = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number) => {
  const raw = String(text ?? "");
  if (ctx.measureText(raw).width <= maxWidth) return raw;
  let out = raw;
  while (out.length > 1 && ctx.measureText(`${out}...`).width > maxWidth) out = out.slice(0, -1);
  return `${out}...`;
};

const drawCellText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  font = "600 14px Inter, Segoe UI, Arial, sans-serif",
  color = "#111827",
) => {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(ellipsize(ctx, text, maxWidth), x, y, maxWidth);
};

const drawPill = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  opts?: { fill?: string; stroke?: string; color?: string; font?: string; padX?: number; h?: number },
) => {
  const font = opts?.font || "700 15px Inter, Segoe UI, Arial, sans-serif";
  const padX = opts?.padX ?? 15;
  const h = opts?.h ?? 38;
  ctx.font = font;
  const width = Math.ceil(ctx.measureText(text).width + padX * 2);
  fillRoundRect(ctx, x, y, width, h, 12, opts?.fill || "#f8fafc");
  strokeRoundRect(ctx, x, y, width, h, 12, opts?.stroke || "#e2e8f0", 1.2);
  ctx.fillStyle = opts?.color || "#334155";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + padX, y + h / 2 + 1);
  return width;
};

const dateTimeLabel = (ts?: number | string | Date | null) => {
  if (!ts) return "--";
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleString("vi-VN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

const dateTimeFullLabel = (ts?: number | string | Date | null) => {
  if (!ts) return "--";
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleString("vi-VN", {
    hour12: false,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};


const stripRangePrefix = (text?: string | null) =>
  String(text || "")
    .replace(/^\s*Dữ liệu xuất:\s*/i, "")
    .replace(/^\s*Range:\s*/i, "")
    .replace(/^\s*Selected range:\s*/i, "")
    .trim();

const normalizePdfRangeText = (options: ExportPdfOptions) => {
  const explicit = stripRangePrefix(options.rangeText);
  if (explicit) return `Dữ liệu xuất: ${explicit}`;

  const fromRaw = options.selectedFromLocal ?? options.selectedFromUtc;
  const toRaw = options.selectedToLocal ?? options.selectedToUtc;
  const fromTs = getOptionalTs(fromRaw);
  const toTs = getOptionalTs(toRaw);
  if (fromTs != null && toTs != null) {
    const days = Math.max(1, Math.ceil((toTs - fromTs) / (24 * 60 * 60 * 1000)));
    return `Dữ liệu xuất: Khoảng đã chọn (${days} ngày) • ${dateTimeFullLabel(fromTs)} → ${dateTimeFullLabel(toTs)}`;
  }

  return "Dữ liệu xuất: Exported data";
};

const rangeLabel = (liveMode: boolean, liveWindow: LiveWindow, histHours: number) => {
  if (liveMode) return `Realtime ${String(liveWindow || "")}`.trim();
  return `History ${histHours || "--"}h`;
};

const durationText = (ms: number) => {
  if (!Number.isFinite(ms) || ms <= 0) return "None";
  let minutes = Math.round(ms / 60000);
  const days = Math.floor(minutes / 1440); minutes -= days * 1440;
  const hours = Math.floor(minutes / 60); minutes -= hours * 60;
  const parts: string[] = [];
  if (days) parts.push(`${days} Days`);
  if (hours) parts.push(`${hours} Hours`);
  if (minutes || parts.length === 0) parts.push(`${minutes} Minutes`);
  return parts.join(" ");
};

const minutesText = (minutes: number) => {
  if (!Number.isFinite(minutes) || minutes <= 0) return "None";
  if (minutes < 1440) return `${Math.round(minutes)}m`;
  return durationText(minutes * 60000);
};

const medianStepMs = (points: CleanPoint[]) => {
  const diffs: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const d = points[i].ts - points[i - 1].ts;
    if (d > 0 && d < 24 * 3600000) diffs.push(d);
  }
  if (!diffs.length) return 0;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
};

const standardDeviation = (values: number[]) => {
  if (values.length <= 1) return 0;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
};

const calcMkt = (tempsC: number[], deltaH = 83.144) => {
  if (!tempsC.length) return null;
  const R = 0.00831446261815324; // kJ/(mol*K)
  const dhOverR = deltaH / R;
  const avgExp = tempsC.reduce((sum, c) => sum + Math.exp(-dhOverR / (c + 273.15)), 0) / tempsC.length;
  if (!avgExp || !Number.isFinite(avgExp)) return null;
  return dhOverR / -Math.log(avgExp) - 273.15;
};

const statsFor = (points: CleanPoint[], deltaH?: number): StatBlock => {
  const temps = points.map((p) => p.temperature).filter(Number.isFinite);
  const hums = points.map((p) => p.humidity).filter(isFiniteNumber);
  const step = medianStepMs(points);
  const firstTs = points[0]?.ts ?? null;
  const lastTs = points[points.length - 1]?.ts ?? null;
  const elapsedMs = firstTs && lastTs ? Math.max(0, lastTs - firstTs + step) : 0;
  let minT: number | null = null;
  let maxT: number | null = null;
  let minTs: number | null = null;
  let maxTs: number | null = null;
  for (const p of points) {
    if (minT == null || p.temperature < minT) { minT = p.temperature; minTs = p.ts; }
    if (maxT == null || p.temperature > maxT) { maxT = p.temperature; maxTs = p.ts; }
  }
  return {
    firstTs,
    lastTs,
    elapsedMs,
    totalReadings: points.length,
    evaluatedReadings: temps.length,
    minT,
    minTs,
    maxT,
    maxTs,
    avgT: temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null,
    stdT: temps.length ? standardDeviation(temps) : null,
    mktT: calcMkt(temps, deltaH),
    minH: hums.length ? Math.min(...hums) : 0,
    maxH: hums.length ? Math.max(...hums) : 0,
  };
};

const calcAlarm = (points: CleanPoint[], threshold: number | null | undefined, dir: "upper" | "lower"): AlarmCalc => {
  if (!isFiniteNumber(threshold)) {
    return { alarm: "--", allowedTime: "Instant", totalMinutes: 0, occurrences: 0, degreeMinutes: 0, status: "OK" };
  }
  const stepFallback = medianStepMs(points) || 300000;
  let totalMinutes = 0;
  let occurrences = 0;
  let degreeMinutes = 0;
  let inRun = false;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const bad = dir === "upper" ? p.temperature > threshold : p.temperature < threshold;
    if (!bad) { inRun = false; continue; }
    if (!inRun) { occurrences += 1; inRun = true; }
    const next = points[i + 1];
    const dtMs = next && next.ts > p.ts ? Math.min(next.ts - p.ts, stepFallback * 3) : stepFallback;
    const mins = dtMs / 60000;
    totalMinutes += mins;
    degreeMinutes += Math.abs(p.temperature - threshold) * mins;
  }
  return {
    alarm: dir === "upper" ? `>${fmt1(threshold, " °C")}` : `<${fmt1(threshold, " °C")}`,
    allowedTime: "Instant",
    totalMinutes,
    occurrences,
    degreeMinutes,
    status: occurrences > 0 ? "Fail" : "OK",
  };
};

const normalizeAlarmRow = (row: AlarmCalc | AlarmRowInput) => {
  if ("totalMinutes" in row) {
    return {
      alarm: row.alarm,
      allowedTime: row.allowedTime,
      totalTime: minutesText(row.totalMinutes),
      occurrences: row.occurrences || "(none)",
      degreeMinutes: fmtNum(row.degreeMinutes),
      status: row.status,
    };
  }
  return {
    alarm: row.alarm,
    allowedTime: row.allowedTime || "Instant",
    totalTime: row.totalTime || "None",
    occurrences: row.occurrences ?? "(none)",
    degreeMinutes: row.degreeMinutes ?? "0.00",
    status: row.status || "OK",
  };
};

const collectEvents = (points: CleanPoint[], extra?: ReportEvent[]) => {
  const out: EventInfo[] = [];
  for (const p of points) {
    if (p.eventText) out.push({ ts: p.ts, event: p.eventText });
  }
  for (const e of extra || []) {
    const rawTs = e.ts ?? e.time;
    const ts = rawTs instanceof Date ? rawTs.getTime() : typeof rawTs === "number" ? rawTs : new Date(rawTs as any).getTime();
    const event = normalizeEventText(e.event ?? e.label);
    if (Number.isFinite(ts) && event) out.push({ ts, event });
  }
  const seen = new Set<string>();
  return out
    .sort((a, b) => a.ts - b.ts)
    .filter((e) => {
      const key = `${e.ts}|${e.event}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const niceRange = (min: number, max: number) => {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * 0.08);
    return { min: min - pad, max: max + pad };
  }
  const span = max - min;
  const pad = Math.max(span * 0.16, 0.8);
  return { min: min - pad, max: max + pad };
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));


const BRAND = {
  navy: "#07172f",
  blue: "#0b4fd7",
  blue2: "#123c9c",
  cyan: "#05b7d8",
  teal: "#0f766e",
  green: "#16a34a",
  red: "#ef4444",
  redDark: "#dc2626",
  amber: "#f59e0b",
  violet: "#7c3aed",
  ink: "#0f172a",
  muted: "#64748b",
  line: "#d9e4f2",
  soft: "#f7fbff",
  softBlue: "#edf5ff",
};


const drawBrandBackground = (ctx: CanvasRenderingContext2D, W: number, H: number) => {
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#ffffff");
  bg.addColorStop(0.62, "#fbfdff");
  bg.addColorStop(1, "#eefbff");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Faint proprietary SmartTech technical pattern on the right.
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = "#7dd3fc";
  ctx.lineWidth = 1;
  for (let i = 0; i < 18; i++) {
    const cx = W - 130 + i * 18;
    ctx.beginPath();
    ctx.arc(cx, 240 + i * 21, 58 + (i % 3) * 16, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = BRAND.blue;
  ctx.font = "900 96px Inter, Segoe UI, Arial, sans-serif";
  ctx.translate(W - 280, H - 210);
  ctx.rotate(-Math.PI / 12);
  ctx.fillText("SMARTTECH", 0, 0);
  ctx.restore();

  drawNanoPattern(ctx, W, H);
  drawSoftGrid(ctx, 42, 118, W - 84, H - 210);
  drawCornerRibbon(ctx, W, H);

  // Exclusive bottom accent bar.
  const bar = ctx.createLinearGradient(0, H - 14, W, H - 14);
  bar.addColorStop(0, BRAND.blue2);
  bar.addColorStop(0.55, BRAND.violet);
  bar.addColorStop(0.82, BRAND.blue);
  bar.addColorStop(1, BRAND.cyan);
  ctx.fillStyle = bar;
  ctx.beginPath();
  ctx.moveTo(0, H - 24);
  ctx.bezierCurveTo(W * 0.25, H - 2, W * 0.72, H - 42, W, H - 18);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();
};

const drawSectionHeader = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  tone: "blue" | "red" | "teal" = "blue",
) => {
  const from = tone === "red" ? "#dc2626" : tone === "teal" ? "#0f766e" : BRAND.blue2;
  const to = tone === "red" ? "#fb7185" : tone === "teal" ? BRAND.cyan : BRAND.cyan;
  const g = ctx.createLinearGradient(x, y, x + w, y);
  g.addColorStop(0, from);
  g.addColorStop(1, to);
  fillRoundRect(ctx, x, y, w, h, 11, "#fff");
  ctx.save();
  roundRect(ctx, x, y, w, h, 11);
  ctx.clip();
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  drawText(ctx, title, x + 16, y + h / 2 + 6, "900 16px Inter, Segoe UI, Arial, sans-serif", "#ffffff", w - 30);
};

const drawMetricCard = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
  color = BRAND.blue,
) => {
  fillRoundRect(ctx, x, y, w, h, 14, "rgba(255,255,255,0.92)");
  strokeRoundRect(ctx, x, y, w, h, 14, "#dbeafe", 1.2);
  drawText(ctx, label, x + 18, y + 22, "800 11px Inter, Segoe UI, Arial, sans-serif", BRAND.muted, w - 34);
  drawText(ctx, value, x + 18, y + 54, "900 22px Inter, Segoe UI, Arial, sans-serif", color, w - 34);
};


const drawSoftGrid = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = "#bfdbfe";
  ctx.lineWidth = 0.7;
  for (let gx = x; gx <= x + w; gx += 28) {
    ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); ctx.stroke();
  }
  for (let gy = y; gy <= y + h; gy += 28) {
    ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); ctx.stroke();
  }
  ctx.restore();
};

const drawCornerRibbon = (ctx: CanvasRenderingContext2D, W: number, H: number, label = "SMARTTECH VALIDATED REPORT") => {
  ctx.save();
  const g = ctx.createLinearGradient(0, 0, 360, 0);
  g.addColorStop(0, BRAND.blue2);
  g.addColorStop(0.55, BRAND.blue);
  g.addColorStop(1, BRAND.cyan);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(370, 0); ctx.lineTo(315, 24); ctx.lineTo(0, 24); ctx.closePath();
  ctx.fill();
  drawText(ctx, label, 42, 17, "800 10px Inter, Segoe UI, Arial, sans-serif", "#ffffff", 270);
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.arc(305 + i * 16, 12, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
};

const drawVerticalBrand = (ctx: CanvasRenderingContext2D, x: number, y: number, h: number) => {
  ctx.save();
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, BRAND.blue);
  g.addColorStop(1, BRAND.cyan);
  fillRoundRect(ctx, x, y, 26, h, 13, "rgba(255,255,255,0.76)");
  strokeRoundRect(ctx, x, y, 26, h, 13, "#dbeafe", 1);
  ctx.translate(x + 17, y + h - 18);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = g;
  ctx.font = "900 10px Inter, Segoe UI, Arial, sans-serif";
  ctx.fillText("SMARTTECH CLOUD • SECURE TEMPERATURE REPORT", 0, 0, h - 36);
  ctx.restore();
};

const drawNanoPattern = (ctx: CanvasRenderingContext2D, W: number, H: number) => {
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = "#38bdf8";
  ctx.fillStyle = "#0b4fd7";
  const ox = W - 250, oy = H - 245;
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 7; c++) {
      const px = ox + c * 34 + (r % 2) * 17;
      const py = oy + r * 29;
      ctx.beginPath(); ctx.arc(px, py, 2.6, 0, Math.PI * 2); ctx.fill();
      if (c < 6) { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + 34, py + ((r % 2) ? -15 : 15)); ctx.stroke(); }
    }
  }
  ctx.restore();
};

const drawQualitySeal = (ctx: CanvasRenderingContext2D, x: number, y: number, status: "OK" | "Fail") => {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + 36, y + 36, 34, 0, Math.PI * 2);
  ctx.fillStyle = status === "Fail" ? "rgba(239,68,68,0.10)" : "rgba(22,163,74,0.10)";
  ctx.fill();
  ctx.strokeStyle = status === "Fail" ? BRAND.red : BRAND.green;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.font = "900 9px Inter, Segoe UI, Arial, sans-serif";
  ctx.fillStyle = status === "Fail" ? BRAND.redDark : BRAND.green;
  ctx.textAlign = "center";
  ctx.fillText(status === "Fail" ? "ALARM" : "PASS", x + 36, y + 32);
  ctx.fillText("CHECKED", x + 36, y + 46);
  ctx.textAlign = "start";
  ctx.restore();
};

const pageCanvas = () => {
  const canvas = document.createElement("canvas");
  const W = 1400;
  const H = 990;
  const dpr = 2;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { canvas, ctx: null as CanvasRenderingContext2D | null, W, H };
  ctx.scale(dpr, dpr);
  drawBrandBackground(ctx, W, H);
  return { canvas, ctx, W, H };
};

const drawFooter = (ctx: CanvasRenderingContext2D, W: number, H: number, options: ExportPdfOptions, page: number, total: number) => {
  const created = dateTimeFullLabel(options.createdAt || new Date());

  // Footer có vùng an toàn riêng để không bị nội dung bảng đè lên.
  ctx.save();
  const fy = H - 86;
  ctx.fillStyle = "rgba(255,255,255,0.97)";
  ctx.fillRect(0, fy, W, 86);

  const strip = ctx.createLinearGradient(0, H - 8, W, H - 8);
  strip.addColorStop(0, BRAND.blue);
  strip.addColorStop(0.55, BRAND.violet);
  strip.addColorStop(1, BRAND.cyan);
  ctx.fillStyle = strip;
  ctx.fillRect(0, H - 10, W, 10);

  ctx.strokeStyle = "#dbeafe";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(42, fy + 2);
  ctx.lineTo(W - 42, fy + 2);
  ctx.stroke();

  // Hàng metadata nhỏ ở trên footer.
  drawText(ctx, `Created: ${created}`, 54, H - 66, "650 11px Inter, Segoe UI, Arial, sans-serif", BRAND.muted, 260);
  if (options.fileLocation) {
    drawText(ctx, `File Location: ${options.fileLocation}`, 324, H - 66, "650 11px Inter, Segoe UI, Arial, sans-serif", BRAND.muted, 250);
  }

  // Source chip bên trái.
  fillRoundRect(ctx, 42, H - 54, 260, 30, 15, "rgba(239,246,255,0.96)");
  strokeRoundRect(ctx, 42, H - 54, 260, 30, 15, "#bfdbfe", 1);
  drawText(ctx, `Source: ${options.source || "SmartTech Cloud"}`, 66, H - 34, "800 11.5px Inter, Segoe UI, Arial, sans-serif", BRAND.blue, 220);

  // Legend nằm riêng ở giữa, không đè metadata.
  const lgY = H - 36;
  ctx.strokeStyle = BRAND.teal;
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(W / 2 - 118, lgY - 5); ctx.lineTo(W / 2 - 82, lgY - 5); ctx.stroke();
  drawText(ctx, "Within Limits", W / 2 - 70, lgY, "800 11.5px Inter, Segoe UI, Arial, sans-serif", BRAND.ink);
  ctx.strokeStyle = BRAND.red;
  ctx.beginPath(); ctx.moveTo(W / 2 + 72, lgY - 5); ctx.lineTo(W / 2 + 108, lgY - 5); ctx.stroke();
  drawText(ctx, "Out of Limits", W / 2 + 120, lgY, "800 11.5px Inter, Segoe UI, Arial, sans-serif", BRAND.ink);

  // Proprietary mark + page chip bên phải.
  fillRoundRect(ctx, W - 382, H - 56, 188, 32, 16, "rgba(255,255,255,0.96)");
  strokeRoundRect(ctx, W - 382, H - 56, 188, 32, 16, "#bae6fd", 1);
  drawText(ctx, "CONFIDENTIAL • SMARTTECH", W - 358, H - 35, "850 10.5px Inter, Segoe UI, Arial, sans-serif", BRAND.blue2, 150);

  fillRoundRect(ctx, W - 160, H - 56, 118, 32, 16, BRAND.blue);
  drawText(ctx, `Page ${page} / ${total}`, W - 138, H - 35, "850 12.5px Inter, Segoe UI, Arial, sans-serif", "#ffffff");
  ctx.restore();
};

const drawLogo = (ctx: CanvasRenderingContext2D, W: number, logo?: HTMLImageElement | null) => {
  const x = W - 218;
  const y = 20;
  const w = 170;
  const h = 74;
  fillRoundRect(ctx, x, y, w, h, 16, "rgba(255,255,255,0.96)");
  strokeRoundRect(ctx, x, y, w, h, 16, "#dbeafe", 1.2);

  if (logo) {
    ctx.drawImage(logo, x + 12, y + 8, 86, 52);
  } else {
    drawText(ctx, "SIT", x + 15, y + 46, "900 32px Arial, sans-serif", BRAND.red);
  }
  drawText(ctx, "SmartTech", x + 100, y + 34, "900 20px Inter, Segoe UI, Arial, sans-serif", BRAND.blue2, 68);
  drawText(ctx, "INSTRUMENTS", x + 100, y + 54, "800 10px Inter, Segoe UI, Arial, sans-serif", BRAND.blue, 68);
  drawText(ctx, "Precision Monitoring", x + 18, y + 68, "700 9px Inter, Segoe UI, Arial, sans-serif", "#38bdf8", w - 28);
};

function drawKeyValueTable(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, rows: string[][], rowH = 34) {
  const h = rows.length * rowH;
  fillRoundRect(ctx, x, y, w, h, 12, "rgba(255,255,255,0.96)");
  strokeRoundRect(ctx, x, y, w, h, 12, "#cfe0f5", 1.2);
  ctx.save();
  roundRect(ctx, x, y, w, h, 12);
  ctx.clip();
  rows.forEach((r, i) => {
    const yy = y + i * rowH;
    ctx.fillStyle = i % 2 === 0 ? "#eef6ff" : "rgba(255,255,255,0.92)";
    ctx.fillRect(x, yy, w, rowH);
    if (i > 0) {
      ctx.strokeStyle = "#dbeafe";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke();
    }
    const colW = w / r.length;
    r.forEach((cell, c) => {
      if (c > 0) {
        ctx.strokeStyle = "#e2e8f0";
        ctx.beginPath(); ctx.moveTo(x + colW * c, yy + 5); ctx.lineTo(x + colW * c, yy + rowH - 5); ctx.stroke();
      }
      drawCellText(ctx, cell, x + colW * c + 13, yy + rowH / 2 + 1, colW - 22, c % 2 === 0 ? "850 13px Inter, Segoe UI, Arial, sans-serif" : "650 13px Inter, Segoe UI, Arial, sans-serif", BRAND.ink);
    });
  });
  ctx.restore();
}

function drawAlarmIcon(ctx: CanvasRenderingContext2D, x: number, y: number, status: "OK" | "Fail") {
  const cardW = 112;
  const cardH = 150;
  fillRoundRect(ctx, x, y - 34, cardW, cardH, 16, "rgba(255,255,255,0.96)");
  strokeRoundRect(ctx, x, y - 34, cardW, cardH, 16, "#cfe0f5", 1.2);
  drawSectionHeader(ctx, x, y - 34, cardW, 34, "ALARM", status === "Fail" ? "red" : "teal");

  ctx.fillStyle = "#ffffff";
  ctx.beginPath(); ctx.arc(x + cardW / 2, y + 48, 38, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = status === "Fail" ? "#fee2e2" : "#dcfce7";
  ctx.lineWidth = 4;
  ctx.stroke();

  if (status === "Fail") {
    ctx.strokeStyle = BRAND.red;
    ctx.lineWidth = 9;
    ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x + 38, y + 30); ctx.lineTo(x + 74, y + 66); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 74, y + 30); ctx.lineTo(x + 38, y + 66); ctx.stroke();
    drawText(ctx, "ALARM TRIGGERED", x + 10, y + 104, "850 11px Inter, Segoe UI, Arial, sans-serif", BRAND.red, cardW - 20);
  } else {
    ctx.strokeStyle = BRAND.green;
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x + 31, y + 50); ctx.lineTo(x + 47, y + 66); ctx.lineTo(x + 79, y + 28); ctx.stroke();
    drawText(ctx, "STATUS OK", x + 27, y + 104, "850 12px Inter, Segoe UI, Arial, sans-serif", BRAND.green, cardW - 20);
  }
}

function drawAlarmTable(ctx: CanvasRenderingContext2D, title: string, rows: ReturnType<typeof normalizeAlarmRow>[], x: number, y: number, w: number) {
  const tone = /upper/i.test(title) ? "red" : "blue";
  const header = ["Alarm", "Allowed Time", "Total Time", "Occurrences", "°C-Minutes", "Status"];
  const baseCol = [135, 170, 170, 160, 245, 110];
  const scale = Math.max(0.45, (w - 20) / baseCol.reduce((a, b) => a + b, 0));
  const col = baseCol.map((c) => c * scale);
  const rowH = 34;
  const headH = 36;
  const h = headH + rowH * (rows.length + 1);
  fillRoundRect(ctx, x, y - 36, w, h + 36, 14, "rgba(255,255,255,0.96)");
  strokeRoundRect(ctx, x, y - 36, w, h + 36, 14, "#cfe0f5", 1.2);
  drawSectionHeader(ctx, x, y - 36, w, 36, title.toUpperCase(), tone === "red" ? "red" : "blue");

  ctx.save();
  roundRect(ctx, x, y, w, rowH * (rows.length + 1), 0);
  ctx.clip();
  ctx.fillStyle = tone === "red" ? "#fff1f2" : "#eef6ff";
  ctx.fillRect(x, y, w, rowH);
  let cx = x + 10;
  header.forEach((h0, i) => { drawCellText(ctx, h0, cx, y + rowH / 2 + 1, col[i] - 12, "850 12px Inter, Segoe UI, Arial, sans-serif", BRAND.ink); cx += col[i]; });
  rows.forEach((r, ri) => {
    const yy = y + rowH * (ri + 1);
    ctx.fillStyle = ri % 2 === 0 ? "rgba(255,255,255,0.96)" : "#f8fbff";
    ctx.fillRect(x, yy, w, rowH);
    const values = [r.alarm, r.allowedTime, r.totalTime, String(r.occurrences), String(r.degreeMinutes), String(r.status)];
    let tx = x + 10;
    values.forEach((v, i) => {
      drawCellText(ctx, v, tx, yy + rowH / 2 + 1, col[i] - 12, i === 5 && String(r.status).toLowerCase() === "fail" ? "900 12px Inter, Segoe UI, Arial, sans-serif" : "650 12px Inter, Segoe UI, Arial, sans-serif", i === 5 && String(r.status).toLowerCase() === "fail" ? BRAND.redDark : BRAND.ink);
      tx += col[i];
    });
  });
  ctx.restore();
}

function drawChart(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  points: CleanPoint[],
  tempThresholds?: Thresholds,
  xDomain?: { from?: string | number | Date; to?: string | number | Date },
) {
  const temps = points.map((p) => p.temperature).filter(Number.isFinite);
  const values = [...temps];
  if (isFiniteNumber(tempThresholds?.min)) values.push(tempThresholds!.min!);
  if (isFiniteNumber(tempThresholds?.max)) values.push(tempThresholds!.max!);
  const r = niceRange(Math.min(...values), Math.max(...values));
  const yMin = r.min;
  const yMax = r.max;
  // Nếu export từ popup Từ/Đến thì cố định trục X theo đúng khoảng người dùng chọn.
  // Như vậy chọn 25/06 → 02/07 thì chart PDF cũng hiển thị mốc 25/06 → 02/07,
  // dù dữ liệu thực tế chỉ bắt đầu từ ngày 30/06.
  const selectedFromTs = getOptionalTs(xDomain?.from);
  const selectedToTs = getOptionalTs(xDomain?.to);
  const firstPointTs = points[0]?.ts || Date.now() - 3600000;
  const lastPointTs = points[points.length - 1]?.ts || firstPointTs + 3600000;
  const xMin = selectedFromTs ?? firstPointTs;
  const xMaxRaw = selectedToTs ?? (lastPointTs > xMin ? lastPointTs : xMin + 3600000);
  const xMax = xMaxRaw > xMin ? xMaxRaw : xMin + 3600000;
  const yToPx = (v: number) => y + (1 - (v - yMin) / (yMax - yMin)) * h;
  const xToPx = (ts: number) => x + ((ts - xMin) / (xMax - xMin)) * w;

  const zone = ctx.createLinearGradient(0, y, 0, y + h);
  zone.addColorStop(0, "rgba(248, 113, 113, 0.16)");
  zone.addColorStop(0.52, "rgba(34, 197, 94, 0.06)");
  zone.addColorStop(1, "rgba(56, 189, 248, 0.10)");
  ctx.fillStyle = zone;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#93c5fd";
  ctx.lineWidth = 1.2;
  ctx.strokeRect(x, y, w, h);

  ctx.save();
  ctx.strokeStyle = "rgba(148, 163, 184, 0.45)";
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);
  for (let i = 0; i <= 5; i++) {
    const yy = y + (h / 5) * i;
    ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke();
    const v = yMax - ((yMax - yMin) / 5) * i;
    drawText(ctx, v.toFixed(1), x - 50, yy + 5, "700 12px Arial, sans-serif", "#475569");
  }
  for (let i = 0; i <= 7; i++) {
    const xx = x + (w / 7) * i;
    ctx.beginPath(); ctx.moveTo(xx, y); ctx.lineTo(xx, y + h); ctx.stroke();
  }
  ctx.restore();

  const thresholdLabels: Array<{ yy: number; label: string; align: "above" | "below" }> = [];

  const drawThreshold = (v: number | null | undefined, label: string) => {
    if (!isFiniteNumber(v)) return;
    const yy = clamp(yToPx(v), y, y + h);
    ctx.save();
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 1.6;
    ctx.setLineDash([7, 6]);
    ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke();
    ctx.restore();

    // Không vẽ chữ ngay tại đây vì line dữ liệu có thể đè lên chữ Max/Min.
    // Lưu lại để vẽ nhãn sau cùng, có nền trắng riêng.
    thresholdLabels.push({
      yy,
      label,
      align: yy < y + 26 ? "below" : "above",
    });
  };
  drawThreshold(tempThresholds?.max, `Max ${fmt1(tempThresholds?.max, "°C")}`);
  drawThreshold(tempThresholds?.min, `Min ${fmt1(tempThresholds?.min, "°C")}`);

  const status = (v: number) =>
    (isFiniteNumber(tempThresholds?.max) && v > tempThresholds!.max!) ||
    (isFiniteNumber(tempThresholds?.min) && v < tempThresholds!.min!) ? "alarm" : "ok";

  /**
   * Vẽ line theo đúng vùng ngưỡng:
   * - Phần nằm trong Min/Max: xanh
   * - Chỉ phần thật sự vượt Min/Max: đỏ
   *
   * Không dùng kiểu "một đầu mút alarm thì cả đoạn đỏ" nữa,
   * vì cách đó làm các đoạn trong ngưỡng bị đỏ theo.
   */
  const drawTempSegment = (a: CleanPoint, b: CleanPoint) => {
    const v0 = a.temperature;
    const v1 = b.temperature;
    if (!Number.isFinite(v0) || !Number.isFinite(v1)) return;

    const cuts = [0, 1];
    const addCutAtThreshold = (threshold?: number | null) => {
      if (!isFiniteNumber(threshold)) return;
      const crosses = (v0 < threshold! && v1 > threshold!) || (v0 > threshold! && v1 < threshold!);
      if (!crosses || v1 === v0) return;
      const t = (threshold! - v0) / (v1 - v0);
      if (t > 0 && t < 1) cuts.push(t);
    };

    addCutAtThreshold(tempThresholds?.min);
    addCutAtThreshold(tempThresholds?.max);

    cuts.sort((m, n) => m - n);

    for (let ci = 1; ci < cuts.length; ci++) {
      const t0 = cuts[ci - 1];
      const t1 = cuts[ci];
      if (t1 <= t0) continue;

      const mid = (t0 + t1) / 2;
      const midTemp = v0 + (v1 - v0) * mid;

      const sx = a.ts + (b.ts - a.ts) * t0;
      const ex = a.ts + (b.ts - a.ts) * t1;
      const sy = v0 + (v1 - v0) * t0;
      const ey = v0 + (v1 - v0) * t1;

      ctx.strokeStyle = status(midTemp) === "alarm" ? "#ef4444" : "#0f766e";
      ctx.beginPath();
      ctx.moveTo(clamp(xToPx(sx), x, x + w), clamp(yToPx(sy), y, y + h));
      ctx.lineTo(clamp(xToPx(ex), x, x + w), clamp(yToPx(ey), y, y + h));
      ctx.stroke();
    }
  };

  if (points.length > 1) {
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = 3;
    for (let i = 1; i < points.length; i++) {
      drawTempSegment(points[i - 1], points[i]);
    }
    ctx.restore();
  }

  // Event marks like LogTag: red dots for inspection/download/sensor events.
  points.forEach((p) => {
    if (!p.eventText) return;
    const px = clamp(xToPx(p.ts), x, x + w);
    const py = clamp(yToPx(p.temperature), y, y + h);
    ctx.fillStyle = "#ef4444";
    ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
  });

  // Vẽ nhãn Max/Min sau cùng để không bị line dữ liệu che.
  thresholdLabels.forEach(({ yy, label, align }) => {
    ctx.save();
    const labelX = x + 10;
    const labelW = Math.max(82, ctx.measureText(label).width + 18);
    const labelH = 18;
    const labelY = align === "below"
      ? clamp(yy + 5, y + 4, y + h - labelH - 4)
      : clamp(yy - labelH - 5, y + 4, y + h - labelH - 4);

    fillRoundRect(ctx, labelX - 4, labelY, labelW, labelH, 7, "rgba(255,255,255,0.92)");
    strokeRoundRect(ctx, labelX - 4, labelY, labelW, labelH, 7, "rgba(239,68,68,0.22)", 1);
    drawText(ctx, label, labelX + 4, labelY + 13, "900 12px Inter, Segoe UI, Arial, sans-serif", "#ef4444");
    ctx.restore();
  });

  drawText(ctx, dateTimeLabel(xMin), x, y + h + 28, "650 12px Arial, sans-serif", "#475569");
  drawText(ctx, dateTimeLabel(xMin + (xMax - xMin) / 2), x + w / 2 - 70, y + h + 28, "650 12px Arial, sans-serif", "#475569");
  drawText(ctx, dateTimeLabel(xMax), x + w - 145, y + h + 28, "650 12px Arial, sans-serif", "#475569");
  drawText(ctx, "Temperature (°C)", x + w / 2 - 54, y + h + 54, "700 12px Arial, sans-serif", "#334155");
  drawText(ctx, "● Events", x + w / 2 + 80, y + h + 54, "700 12px Arial, sans-serif", "#ef4444");
}

function drawOverviewPage(args: {
  points: CleanPoint[];
  stats: StatBlock;
  events: EventInfo[];
  serial: string;
  page: number;
  total: number;
  logo: HTMLImageElement | null;
  options: ExportPdfOptions;
  upperRows: ReturnType<typeof normalizeAlarmRow>[];
  lowerRows: ReturnType<typeof normalizeAlarmRow>[];
}) {
  const { canvas, ctx, W, H } = pageCanvas();
  if (!ctx) return canvas;
  const { points, stats, serial, page, total, logo, options, upperRows, lowerRows } = args;
  const alarmFail = [...upperRows, ...lowerRows].some((x) => String(x.status).toLowerCase() === "fail");
  // Proprietary SmartTech header.
  ctx.fillStyle = BRAND.blue;
  fillRoundRect(ctx, 42, 34, 7, 58, 4, BRAND.blue);
  fillRoundRect(ctx, 52, 34, 5, 58, 3, BRAND.cyan);
  drawText(ctx, "SMARTTECH TEMPERATURE MONITORING REPORT", 76, 58, "900 28px Inter, Segoe UI, Arial, sans-serif", BRAND.navy, 690);
  drawText(ctx, `DEVICE SERIAL: ${options.serialLabel || serial}`, 76, 88, "700 17px Inter, Segoe UI, Arial, sans-serif", BRAND.muted, 690);
  drawLogo(ctx, W, logo);
  drawVerticalBrand(ctx, 18, 132, 720);

  const headerTextX = W - 560;
  const headerTextW = 310;
  drawText(ctx, `Downloaded: ${dateTimeFullLabel(options.downloadedAt || new Date())}`, headerTextX, 42, "800 12px Inter, Segoe UI, Arial, sans-serif", BRAND.blue, headerTextW);
  drawText(ctx, `All Date-Time values are in`, headerTextX, 70, "650 12px Inter, Segoe UI, Arial, sans-serif", BRAND.ink, headerTextW);
  drawText(ctx, `${options.timezoneLabel || "UTC +07:00 PDF Timezone"}`, headerTextX, 88, "800 12px Inter, Segoe UI, Arial, sans-serif", BRAND.blue, headerTextW);

  // Diverse executive KPI strip.
  const kpiY = 104;
  drawPill(ctx, 76, kpiY, `${stats.totalReadings} readings`, { fill: "rgba(239,246,255,0.92)", stroke: "#bfdbfe", color: BRAND.blue2, h: 30, font: "850 12px Inter, Segoe UI, Arial, sans-serif" });
  drawPill(ctx, 210, kpiY, `Avg ${fmt1(stats.avgT, " °C")}`, { fill: "rgba(240,253,250,0.92)", stroke: "#99f6e4", color: BRAND.teal, h: 30, font: "850 12px Inter, Segoe UI, Arial, sans-serif" });
  drawPill(ctx, 326, kpiY, alarmFail ? "Alarm triggered" : "Within limits", { fill: alarmFail ? "rgba(254,242,242,0.92)" : "rgba(240,253,244,0.92)", stroke: alarmFail ? "#fecaca" : "#bbf7d0", color: alarmFail ? BRAND.redDark : BRAND.green, h: 30, font: "850 12px Inter, Segoe UI, Arial, sans-serif" });

  drawAlarmIcon(ctx, 54, 136, alarmFail ? "Fail" : "OK");
  drawQualitySeal(ctx, 80, 252, alarmFail ? "Fail" : "OK");
  drawSectionHeader(ctx, 190, 104, W - 454, 34, "RECORDER INFO & CONFIGURATION", "blue");
  const recorderRows = [
    [`Description: ${options.description || "--"}`],
    [`Serial #: ${options.serialLabel || serial}`, `Model: ${options.model || "--"}`, `Battery: ${options.battery || "--"}`, `Trip #: ${options.tripNumber ?? "--"}`],
    [`Start type: ${options.startType || "--"}`, `Start delay: ${options.startDelay || "None"}`, `Interval: ${options.intervalLabel || minutesText((medianStepMs(points) || 0) / 60000)}`],
  ];
  drawKeyValueTable(ctx, 190, 138, W - 454, recorderRows, 32);

  const channelLabel = options.channelLabel || serial.match(/CH\d+$/i)?.[0] || "";
  drawSectionHeader(ctx, 190, 252, W - 454, 34, `RECORDED DATA ${channelLabel ? `- ${channelLabel}` : ""}`, "blue");
  const selectedRangeText = stripRangePrefix(normalizePdfRangeText(options));

  const recRows = [
    [selectedRangeText ? `Selected range: ${selectedRangeText}` : `First reading: ${dateTimeFullLabel(stats.firstTs)}`, selectedRangeText ? `First reading: ${dateTimeFullLabel(stats.firstTs)}` : `Temperature statistics`],
    [`Last reading: ${dateTimeFullLabel(stats.lastTs)}`, `Lowest: ${fmt1(stats.minT, " °C")} @ ${dateTimeFullLabel(stats.minTs)}`],
    [`Elapsed time: ${durationText(stats.elapsedMs)}`, `Highest: ${fmt1(stats.maxT, " °C")} @ ${dateTimeFullLabel(stats.maxTs)}`],
    [`Total readings: ${stats.totalReadings}`, `Average reading: ${fmt1(stats.avgT, " °C")}`],
    [`First evaluated: ${dateTimeFullLabel(stats.firstTs)}`, `Standard Deviation: ${fmt1(stats.stdT, " °C")} (S)`],
    [`Last evaluated: ${dateTimeFullLabel(stats.lastTs)}`, `MKT(ΔH ${options.mktDeltaH || 83.144}): ${fmt1(stats.mktT, " °C")}`],
    [`Evaluated Time: ${durationText(stats.elapsedMs)}`],
    [`Evaluated Readings: ${stats.evaluatedReadings}`],
  ];
  drawKeyValueTable(ctx, 190, 286, W - 454, recRows, 28);

  // Right-side statistics card makes the report feel like a SmartTech report while keeping original values.
  drawSectionHeader(ctx, W - 244, 104, 190, 34, "TEMP STATS", "teal");
  drawMetricCard(ctx, W - 244, 148, 190, 64, "Lowest", `${fmt1(stats.minT, " °C")}`, BRAND.blue);
  drawMetricCard(ctx, W - 244, 220, 190, 64, "Highest", `${fmt1(stats.maxT, " °C")}`, BRAND.red);
  drawMetricCard(ctx, W - 244, 292, 190, 64, "Average", `${fmt1(stats.avgT, " °C")}`, BRAND.ink);
  drawMetricCard(ctx, W - 244, 364, 190, 64, "Std. Deviation", `${fmt1(stats.stdT, " °C")}`, BRAND.ink);

  drawAlarmTable(ctx, "Upper Alarms", upperRows, 54, 556, (W - 124) / 2);
  drawAlarmTable(ctx, "Lower Alarms", lowerRows, 54 + (W - 124) / 2 + 16, 556, (W - 124) / 2);

  drawSectionHeader(ctx, 54, 680, 320, 34, "TEMPERATURE OVER TIME (°C)", "blue");
  if (selectedRangeText) {
    drawText(ctx, `Range: ${selectedRangeText}`, 392, 703, "800 12px Inter, Segoe UI, Arial, sans-serif", BRAND.muted, 620);
  }
  drawText(ctx, "Temp °C", 54, 732, "700 13px Inter, Segoe UI, Arial, sans-serif", BRAND.muted);
  drawText(ctx, "Temp °C", W - 118, 732, "700 13px Inter, Segoe UI, Arial, sans-serif", BRAND.muted);
  fillRoundRect(ctx, 54, 704, W - 108, 220, 14, "rgba(255,255,255,0.82)");
  strokeRoundRect(ctx, 54, 704, W - 108, 220, 14, "#dbeafe", 1.2);
  drawChart(ctx, 110, 740, W - 220, 118, points, options.tempThresholds, {
    from: options.selectedFromUtc,
    to: options.selectedToUtc,
  });

  drawText(ctx, "Events Info", 54, 920, "850 18px Inter, Segoe UI, Arial, sans-serif", BRAND.ink);
  drawFooter(ctx, W, H, options, page, total);
  return canvas;
}

function drawEventsPage(events: EventInfo[], page: number, total: number, options: ExportPdfOptions) {
  const { canvas, ctx, W, H } = pageCanvas();
  if (!ctx) return canvas;
  drawSectionHeader(ctx, 54, 46, 360, 42, "EVENTS INFO", "blue");
  drawText(ctx, "Timeline markers collected during the selected recording period", 54, 116, "650 15px Inter, Segoe UI, Arial, sans-serif", "#64748b");
  drawPill(ctx, 54, 132, "X = Sensor Disconnected", { fill: "#fff1f2", stroke: "#fecaca", color: BRAND.redDark, h: 30, font: "800 12px Inter, Segoe UI, Arial, sans-serif" });
  drawPill(ctx, 250, 132, "I = Inspection", { fill: "#eff6ff", stroke: "#bfdbfe", color: BRAND.blue2, h: 30, font: "800 12px Inter, Segoe UI, Arial, sans-serif" });
  drawPill(ctx, 386, 132, "D = Download", { fill: "#ecfeff", stroke: "#a5f3fc", color: BRAND.teal, h: 30, font: "800 12px Inter, Segoe UI, Arial, sans-serif" });
  const rowsPerCol = 22;
  const colW = 610;
  const startIdx = (page - 2) * rowsPerCol * 2;
  for (let c = 0; c < 2; c++) {
    const x = 54 + c * (colW + 70);
    const slice = events.slice(startIdx + c * rowsPerCol, startIdx + (c + 1) * rowsPerCol);
    fillRoundRect(ctx, x, 184, colW, rowsPerCol * 30 + 24, 16, "rgba(255,255,255,0.90)");
    strokeRoundRect(ctx, x, 184, colW, rowsPerCol * 30 + 24, 16, "#dbeafe", 1.2);
    slice.forEach((e, i) => {
      const y = 220 + i * 30;
      ctx.fillStyle = i % 2 === 0 ? "#f8fbff" : "#ffffff";
      ctx.fillRect(x + 10, y - 18, colW - 20, 25);
      ctx.fillStyle = /disconnect|X/i.test(e.event) ? BRAND.red : /download|D/i.test(e.event) ? BRAND.teal : BRAND.blue;
      ctx.beginPath(); ctx.arc(x + 22, y - 6, 4, 0, Math.PI * 2); ctx.fill();
      drawCellText(ctx, `${dateTimeFullLabel(e.ts)}   ${e.event}`, x + 34, y - 5, colW - 48, "650 13px Inter, Segoe UI, Arial, sans-serif", "#111827");
    });
  }
  if (!events.length) drawText(ctx, "No events.", 54, 160, "700 17px Arial, sans-serif", "#64748b");
  drawFooter(ctx, W, H, options, page, total);
  return canvas;
}

function drawDataTablePage(args: {
  serial: string;
  rows: CleanPoint[];
  startIndex: number;
  page: number;
  total: number;
  options: ExportPdfOptions;
}) {
  const { canvas, ctx, W, H } = pageCanvas();
  if (!ctx) return canvas;
  const { serial, rows, startIndex, page, total, options } = args;
  drawSectionHeader(ctx, 54, 42, 460, 42, `RECORDED DATA TABLE`, "blue");
  drawText(ctx, `${serial}`, 536, 72, "900 22px Inter, Segoe UI, Arial, sans-serif", BRAND.navy, 480);
  drawText(ctx, normalizePdfRangeText(options), 54, 112, "600 16px Arial, sans-serif", "#64748b");
  drawPill(ctx, W - 278, 48, "Audit-ready rows", { fill: "#eff6ff", stroke: "#bfdbfe", color: BRAND.blue2, h: 30, font: "800 12px Inter, Segoe UI, Arial, sans-serif" });

  const x = 54;
  const y = 130;
  const w = W - 108;
  const headerH = 34;
  const rowH = 22;
  const cols = [
    { label: "Index", w: 76 },
    { label: "Date Time", w: 320 },
    { label: "°C", w: 110 },
    { label: "Humidity", w: 130 },
    { label: "Events", w: 210 },
    { label: "Serial", w: 340 },
  ];
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 1.3;
  ctx.strokeRect(x, y, w, headerH + rows.length * rowH);
  ctx.fillStyle = "#eef2ff";
  ctx.fillRect(x + 1, y + 1, w - 2, headerH - 2);
  let cx = x + 10;
  cols.forEach((c) => { drawCellText(ctx, c.label, cx, y + headerH / 2 + 1, c.w - 12, "800 13px Arial, sans-serif"); cx += c.w; });

  rows.forEach((p, i) => {
    const yy = y + headerH + i * rowH;
    const code = eventCode(p.eventText);
    ctx.fillStyle = i % 2 === 0 ? "#ffffff" : "#f8fafc";
    ctx.fillRect(x + 1, yy + 1, w - 2, rowH - 2);
    let tx = x + 10;
    const vals = [String(startIndex + i + 1), dateTimeFullLabel(p.ts), fmt1(p.temperature), p.humidity == null ? "--" : fmt1(p.humidity, "%"), code, serial];
    vals.forEach((v, ci) => {
      drawCellText(ctx, v, tx, yy + rowH / 2 + 1, cols[ci].w - 12, ci === 2 ? "700 12px Arial, sans-serif" : "600 12px Arial, sans-serif", code && ci === 4 ? "#dc2626" : "#111827");
      tx += cols[ci].w;
    });
  });
  drawText(ctx, "Events: X-Sensor Disconnected   I-Inspection Mark   D-Download Mark", 54, H - 94, "700 12.5px Arial, sans-serif", "#64748b");
  drawFooter(ctx, W, H, options, page, total);
  return canvas;
}

function drawSummaryPage(args: {
  serial: string;
  stats: StatBlock;
  upper: AlarmCalc;
  lower: AlarmCalc;
  page: number;
  total: number;
  options: ExportPdfOptions;
}) {
  const { canvas, ctx, W, H } = pageCanvas();
  if (!ctx) return canvas;
  const { serial, stats, upper, lower, page, total, options } = args;
  drawSectionHeader(ctx, 54, 42, 260, 44, "SUMMARY", "teal");
  drawText(ctx, "Statistics for started readings and compliance review", 54, 118, "800 18px Inter, Segoe UI, Arial, sans-serif", "#111827");
  drawPill(ctx, W - 292, 52, "SmartTech compliance summary", { fill: "#ecfeff", stroke: "#a5f3fc", color: BRAND.teal, h: 32, font: "800 12px Inter, Segoe UI, Arial, sans-serif" });
  const nonAlertRange = `${fmt1(options.tempThresholds?.min, "")} to ${fmt1(options.tempThresholds?.max, "")} °C`;
  const rows = [
    ["LogTag ID", options.serialLabel || serial],
    ["Description", options.description || "--"],
    ["Battery status", options.battery || "--"],
    ["Time zone", options.timezoneLabel || "UTC +07:00 PDF Timezone"],
    ["Reading interval", options.intervalLabel || minutesText((stats.elapsedMs / Math.max(1, stats.totalReadings)) / 60000)],
    ["Number of starts", String(options.tripNumber ?? "--")],
    ["Number of readings", String(stats.totalReadings)],
    ["Number of started readings", String(stats.evaluatedReadings)],
    ["Non alert range", nonAlertRange],
    ["First reading", dateTimeFullLabel(stats.firstTs)],
    ["Last reading", dateTimeFullLabel(stats.lastTs)],
    ["Elapsed Time", durationText(stats.elapsedMs)],
    ["Readings range", `${fmt1(stats.minT, "")} to ${fmt1(stats.maxT, "")} °C`],
    ["Average reading", fmt1(stats.avgT, " °C")],
    ["Standard Deviation (S)", fmt1(stats.stdT, " °C")],
    [`Time above/equal ${fmt1(options.tempThresholds?.max, " °C")}`, minutesText(upper.totalMinutes)],
    [`Time below/equal ${fmt1(options.tempThresholds?.min, " °C")}`, minutesText(lower.totalMinutes)],
    [`Degree Minutes above ${fmt1(options.tempThresholds?.max, " °C")}`, `${fmtNum(upper.degreeMinutes)} °C-Minutes`],
    [`Degree Minutes below ${fmt1(options.tempThresholds?.min, " °C")}`, `${fmtNum(lower.degreeMinutes)} °C-Minutes`],
    ["Mean Kinetic Temperature", fmt1(stats.mktT, " °C")],
  ];
  const x = 54;
  let y = 132;
  const rowH = 34;
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 1.3;
  ctx.strokeRect(x, y, W - 108, rows.length * rowH);
  rows.forEach((r, i) => {
    const yy = y + i * rowH;
    ctx.fillStyle = i % 2 === 0 ? "#f8fafc" : "#ffffff";
    ctx.fillRect(x + 1, yy + 1, W - 110, rowH - 2);
    drawCellText(ctx, r[0], x + 12, yy + rowH / 2 + 1, 430, "800 14px Arial, sans-serif");
    drawCellText(ctx, r[1], x + 468, yy + rowH / 2 + 1, W - 610, "600 14px Arial, sans-serif");
  });
  drawFooter(ctx, W, H, options, page, total);
  return canvas;
}

function drawDaySummaryPage(points: CleanPoint[], page: number, total: number, options: ExportPdfOptions) {
  const { canvas, ctx, W, H } = pageCanvas();
  if (!ctx) return canvas;
  drawSectionHeader(ctx, 54, 42, 310, 44, "DAY SUMMARY", "blue");
  drawText(ctx, "Daily maximum/minimum temperatures and alarm exposure", 54, 112, "700 16px Inter, Segoe UI, Arial, sans-serif", BRAND.muted, 720);
  const groups = new Map<string, CleanPoint[]>();
  for (const p of points) {
    const key = new Date(p.ts).toLocaleDateString("vi-VN");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  const days = Array.from(groups.entries()).sort((a, b) => groups.get(b[0])![0].ts - groups.get(a[0])![0].ts);
  const upper = options.tempThresholds?.max;
  const lower = options.tempThresholds?.min;
  const x = 54;
  const y = 118;
  const rowH = 36;
  const cols = [90, 210, 180, 270, 180, 270];
  const headers = ["Day", "Date", "Max (°C)", "Time above/equal upper alert", "Min (°C)", "Time below/equal lower alert"];
  ctx.strokeStyle = "#111827";
  ctx.strokeRect(x, y, W - 108, rowH * (Math.min(days.length, 20) + 1));
  ctx.fillStyle = "#eef2ff"; ctx.fillRect(x + 1, y + 1, W - 110, rowH - 2);
  let cx = x + 10;
  headers.forEach((h, i) => { drawCellText(ctx, h, cx, y + rowH / 2 + 1, cols[i] - 12, "800 13px Arial, sans-serif"); cx += cols[i]; });
  days.slice(0, 20).forEach(([day, list], i) => {
    const yy = y + rowH * (i + 1);
    const s = statsFor(list, options.mktDeltaH);
    const up = calcAlarm(list, upper, "upper");
    const low = calcAlarm(list, lower, "lower");
    ctx.fillStyle = i % 2 === 0 ? "#ffffff" : "#f8fafc"; ctx.fillRect(x + 1, yy + 1, W - 110, rowH - 2);
    const vals = [String(-i), day, fmt1(s.maxT), minutesText(up.totalMinutes), fmt1(s.minT), minutesText(low.totalMinutes)];
    let tx = x + 10;
    vals.forEach((v, ci) => { drawCellText(ctx, v, tx, yy + rowH / 2 + 1, cols[ci] - 12, "600 13px Arial, sans-serif"); tx += cols[ci]; });
  });
  drawFooter(ctx, W, H, options, page, total);
  return canvas;
}

const addCanvasToPdf = (pdf: jsPDF, canvas: HTMLCanvasElement, isFirst: boolean) => {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  if (!isFirst) pdf.addPage("a4", "landscape");
  const img = canvas.toDataURL("image/png", 1.0);
  pdf.addImage(img, "PNG", 0, 0, pageW, pageH, undefined, "FAST");
};

export async function exportPdf(
  _element: HTMLElement,
  deviceId: string,
  liveMode: boolean,
  liveWindow: LiveWindow,
  histHours: number,
  points: Point[],
  options: ExportPdfOptions = {},
) {
  const cleanPoints = normalizePoints(points);
  if (cleanPoints.length === 0) {
    alert("Không có dữ liệu để xuất PDF.");
    return;
  }

  const finalOptions: ExportPdfOptions = {
    ...options,
    rangeText: normalizePdfRangeText(options),
    source: options.source || `${safeFilePart(deviceId)}.ltd`,
    createdAt: options.createdAt || new Date(),
  };

  const logo = await loadImage(finalOptions.logoUrl || "/Pictures/logo.png");
  const stats = statsFor(cleanPoints, finalOptions.mktDeltaH);
  const upperCalc = calcAlarm(cleanPoints, finalOptions.tempThresholds?.max, "upper");
  const lowerCalc = calcAlarm(cleanPoints, finalOptions.tempThresholds?.min, "lower");
  const upperRows = (finalOptions.upperAlarms?.length ? finalOptions.upperAlarms : [upperCalc]).map(normalizeAlarmRow);
  const lowerRows = (finalOptions.lowerAlarms?.length ? finalOptions.lowerAlarms : [lowerCalc]).map(normalizeAlarmRow);
  const events = collectEvents(cleanPoints, finalOptions.events);

  const eventRowsPerPage = 44;
  const eventPageCount = events.length ? Math.ceil(events.length / eventRowsPerPage) : 1;
  const rowsPerPage = 30;
  const tablePageCount = Math.max(1, Math.ceil(cleanPoints.length / rowsPerPage));
  const totalPages = 1 + eventPageCount + tablePageCount + 2;

  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4", compress: true });
  let pageNo = 1;

  addCanvasToPdf(pdf, drawOverviewPage({
    points: cleanPoints,
    stats,
    events,
    serial: deviceId,
    page: pageNo,
    total: totalPages,
    logo,
    options: finalOptions,
    upperRows,
    lowerRows,
  }), true);
  pageNo++;

  for (let i = 0; i < eventPageCount; i++) {
    const pageEvents = events.slice(i * eventRowsPerPage, (i + 1) * eventRowsPerPage);
    addCanvasToPdf(pdf, drawEventsPage(pageEvents, pageNo, totalPages, finalOptions), false);
    pageNo++;
  }

  for (let i = 0; i < tablePageCount; i++) {
    const startIndex = i * rowsPerPage;
    addCanvasToPdf(pdf, drawDataTablePage({
      serial: deviceId,
      rows: cleanPoints.slice(startIndex, startIndex + rowsPerPage),
      startIndex,
      page: pageNo,
      total: totalPages,
      options: finalOptions,
    }), false);
    pageNo++;
  }

  addCanvasToPdf(pdf, drawSummaryPage({
    serial: deviceId,
    stats,
    upper: upperCalc,
    lower: lowerCalc,
    page: pageNo,
    total: totalPages,
    options: finalOptions,
  }), false);
  pageNo++;

  addCanvasToPdf(pdf, drawDaySummaryPage(cleanPoints, pageNo, totalPages, finalOptions), false);

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  pdf.save(`LogTag_Report_${safeFilePart(deviceId)}_${ts}.pdf`);
}
