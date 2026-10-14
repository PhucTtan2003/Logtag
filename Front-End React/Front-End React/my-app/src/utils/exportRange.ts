// src/utils/exportRange.ts
export type ExportMode = "excel" | "pdf";

export type NormalizedExportRange = {
  /** Local input value used by UI/caller, format yyyy-MM-ddTHH:mm */
  fromLocal: string;
  toLocal: string;

  /** UTC ISO used for API query */
  fromUtc: string;
  toUtc: string;

  /** The only text PDF should display for selected range */
  rangeText: string;

  /** Extra aliases for older callers */
  selectedFromLocal: string;
  selectedToLocal: string;
  selectedFromUtc: string;
  selectedToUtc: string;
  label: string;
  displayText: string;
  dayCount: number;
  days: number;
};

type BuildArgs = {
  fromLocal?: string | Date | null;
  toLocal?: string | Date | null;
  range?: string | null;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function toDatetimeLocalValue(value: Date | string | number) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatLocalFull(d: Date) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} ${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function startOfLocalDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfLocalDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function isLocalMidnight(d: Date) {
  return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0;
}

function parseLocalDateTime(v?: string | Date | null): Date | null {
  if (!v) return null;
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : new Date(v.getTime());
  }

  const s = String(v).trim();
  if (!s) return null;

  // HTML datetime-local: 2026-06-20T00:00 or 2026-06-20 00:00
  const isoLocal = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (isoLocal) {
    const [, yy, mm, dd, hh = "0", mi = "0", ss = "0"] = isoLocal;
    return new Date(Number(yy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss), 0);
  }

  // Browser display: 06/20/2026 12:00 AM
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (us) {
    const [, mm, dd, yy, hhRaw, mi, ss = "0", ampm] = us;
    let hh = Number(hhRaw);
    if (/PM/i.test(ampm) && hh < 12) hh += 12;
    if (/AM/i.test(ampm) && hh === 12) hh = 0;
    return new Date(Number(yy), Number(mm) - 1, Number(dd), hh, Number(mi), Number(ss), 0);
  }

  // Vietnamese display: 20/06/2026 00:00 or 20/06/2026 12:00 AM
  const vi = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?$/i);
  if (vi) {
    const [, dd, mm, yy, hhRaw, mi, ss = "0", ampm] = vi;
    let hh = Number(hhRaw);
    if (ampm) {
      if (/PM/i.test(ampm) && hh < 12) hh += 12;
      if (/AM/i.test(ampm) && hh === 12) hh = 0;
    }
    return new Date(Number(yy), Number(mm) - 1, Number(dd), hh, Number(mi), Number(ss), 0);
  }

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDays(d: Date, days: number) {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + days);
  return x;
}

function calendarDayCountInclusive(from: Date, to: Date) {
  const a = startOfLocalDay(from).getTime();
  const b = startOfLocalDay(to).getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

function defaultRange(range?: string | null): { from: Date; to: Date } {
  const now = new Date();
  const to = now;
  const r = String(range ?? "7d").toLowerCase();
  if (r === "1h") return { from: new Date(now.getTime() - 1 * 60 * 60 * 1000), to };
  if (r === "6h") return { from: new Date(now.getTime() - 6 * 60 * 60 * 1000), to };
  if (r === "24h") return { from: new Date(now.getTime() - 24 * 60 * 60 * 1000), to };
  if (r === "30d") return { from: addDays(now, -30), to };
  if (r === "62d") return { from: addDays(now, -62), to };
  return { from: addDays(now, -7), to };
}

function normalizeArgs(arg1?: BuildArgs | string | Date | null, arg2?: string | Date | null): BuildArgs {
  if (arg1 && typeof arg1 === "object" && !(arg1 instanceof Date)) {
    return arg1 as BuildArgs;
  }
  return { fromLocal: arg1 as string | Date | null | undefined, toLocal: arg2 };
}

/**
 * Single source of truth for User/Admin export range.
 * Rule:
 * 20/06/2026 12:00 AM -> 24/06/2026 12:00 AM
 * means 5 calendar days:
 * 00:00:00 20/06/2026 -> 23:59:59 24/06/2026.
 */
export function buildExportRange(arg1?: BuildArgs | string | Date | null, arg2?: string | Date | null): NormalizedExportRange {
  const args = normalizeArgs(arg1, arg2);
  const fallback = defaultRange(args.range);

  let from = parseLocalDateTime(args.fromLocal) ?? fallback.from;
  let to = parseLocalDateTime(args.toLocal) ?? fallback.to;

  if (from.getTime() > to.getTime()) {
    const tmp = from;
    from = to;
    to = tmp;
  }

  // Nếu user chọn mốc Đến = 12:00 AM, hiểu là lấy hết ngày đó.
  if (isLocalMidnight(to)) {
    to = endOfLocalDay(to);
  }

  const dayCount = calendarDayCountInclusive(from, to);
  const rangeText = `Khoảng đã chọn (${dayCount} ngày) • ${formatLocalFull(from)} → ${formatLocalFull(to)}`;

  const fromLocal = toDatetimeLocalValue(from);
  const toLocal = toDatetimeLocalValue(to);
  const fromUtc = from.toISOString();
  const toUtc = to.toISOString();

  return {
    fromLocal,
    toLocal,
    fromUtc,
    toUtc,
    rangeText,
    selectedFromLocal: fromLocal,
    selectedToLocal: toLocal,
    selectedFromUtc: fromUtc,
    selectedToUtc: toUtc,
    label: rangeText,
    displayText: rangeText,
    dayCount,
    days: dayCount,
  };
}
