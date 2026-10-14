import React, { useEffect, useMemo, useRef, useState } from "react";
import Chart from "../components/Chart/Chart";
import { useHistoryData } from "../hooks/useHistoryData";
import { useLiveReadings } from "../hooks/useUserChartLive";
import { toUtcIsoForQuery } from "../utils/time";
import { exportPdf } from "../pages/User/userchart/exports/exportPdf";
import { exportExcel } from "../pages/User/userchart/exports/exportExcel";

import type { LiveWindow, Point } from "../pages/User/userchart/types";
import type { DataPoint } from "../hooks/useSensorChartDataRange";
import RangeExportDialog from "../components/Export/RangeExportDialog";
import "../styles/Chart/ChannelChart.css";
import { useAlertThreshold } from "../hooks/useAlertThreshold";

/* =========================================================
   HISTORY TABLE
========================================================= */
function HistoryTable({ data }: { data: DataPoint[] }) {
  if (!data || data.length === 0) {
    return <div className="history-table-empty">Không có dữ liệu.</div>;
  }

  return (
    <div className="history-table-wrap">
      <table className="history-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Thời gian</th>
            <th>Nhiệt độ (°C)</th>
            <th>Độ ẩm (%RH)</th>
          </tr>
        </thead>
        <tbody>
          {data.map((p, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>{new Date(p.time).toLocaleString()}</td>
              <td>{p.temperature.toFixed(2)}</td>
              <td>{p.humidity.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* =========================================================
   FORMAT DATA + ALARM LOGIC (🔥 PHẦN QUAN TRỌNG)
========================================================= */
const toDataPoints = (
  pts: Point[],
  tempThresholds?: { min?: number | null; max?: number | null }
): DataPoint[] =>
  pts.map((p, i) => {
    const temp = p.temperature ?? 0;

    const isTempAlarm =
      (tempThresholds?.max != null && temp > tempThresholds.max) ||
      (tempThresholds?.min != null && temp < tempThresholds.min);

    return {
      time:
        typeof p.timestamp === "number"
          ? p.timestamp
          : new Date(p.timestamp).getTime(),
      label: p.label ?? `Điểm ${i + 1}`,
      temperature: temp,
      humidity: p.humidity ?? 0,
      isTempAlarm, // ✅ KEY: Chart.tsx sẽ dùng để đổi màu
    };
  });


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

/* =========================================================
   ORIENTATION HELPERS
========================================================= */
async function tryLockLandscape() {
  try {
    const s: any = window.screen;
    if (s?.orientation?.lock) {
      await s.orientation.lock("landscape");
      return true;
    }
  } catch {}
  return false;
}

function tryUnlockOrientation() {
  try {
    const s: any = window.screen;
    s?.orientation?.unlock?.();
  } catch {}
}

/* =========================================================
   CHANNEL CHART
========================================================= */
type Props = {
  deviceId: string;
  liveMode: boolean;
  liveWindow: LiveWindow;
  histHours: number;
  forceTable: boolean;

  channelIndex?: number;
  channelCount?: number;
  onPrevChannel?: () => void;
  onNextChannel?: () => void;
};

export default function ChannelChart({
  deviceId,
  liveMode,
  liveWindow,
  histHours,
  forceTable,
  channelIndex,
  channelCount,
  onPrevChannel,
  onNextChannel,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const [showTable, setShowTable] = useState(false);
  const [full, setFull] = useState(false);
  const [fullShowTable, setFullShowTable] = useState(false);
  const [landLocked, setLandLocked] = useState(false);
  const [exportMode, setExportMode] = useState<"excel" | "pdf" | null>(null);

  /* ✅ THRESHOLD THẬT (TỪ BACKEND) */
  const tempThresholds = useAlertThreshold(deviceId);
  const humThresholds = undefined;

  /* DATA */
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

  const points = useMemo(
    () => (liveMode ? liveData : histData),
    [liveMode, liveData, histData]
  );

  /* ✅ DATA ĐÃ ĐƯỢC GẮN isTempAlarm */
const data = useMemo(() => {
  const tMin = tempThresholds?.min;
  const tMax = tempThresholds?.max;

  return toDataPoints(points).map((d) => {
    const alarm =
      (tMin != null && d.temperature < tMin) ||
      (tMax != null && d.temperature > tMax);

    return {
      ...d,
      isTempAlarm: alarm,
    };
  });
}, [points, tempThresholds]);

  const effectiveTable = !liveMode && (forceTable || showTable);

  const latencyLabel = liveUnavailable
    ? "Realtime không khả dụng"
    : latencyMs != null
    ? `${latencyMs} ms`
    : "—";

  /* =========================================================
     FULLSCREEN SCROLL LOCK
  ========================================================= */
  useEffect(() => {
    if (!full) return;

    const scrollY = window.scrollY;
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";

    return () => {
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.width = "";
      window.scrollTo(0, scrollY);
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

  /* =========================================================
     FULLSCREEN HANDLERS
  ========================================================= */
  const openFull = async () => {
    setFullShowTable(false);
    setFull(true);
    setLandLocked(await tryLockLandscape());
  };

  const closeFull = () => {
    setFull(false);
    setLandLocked(false);
    tryUnlockOrientation();
  };

  /* =========================================================
     EXPORT
  ========================================================= */
  const onExportPdf = () => {
    if (!wrapRef.current || data.length === 0) return;
    setExportMode("pdf");
  };

  const onExportRangeConfirm = async (fromLocal: string, toLocal: string) => {
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

  const idx = channelIndex ?? 0;
  const count = channelCount ?? 0;
  const canPrev = idx > 0;
  const canNext = idx < count - 1;

  return (
    <>
      <div className="chart-panel ios-card" ref={wrapRef}>
        <div className="channel-header">
          <div className="channel-title">
            <span className="channel-label">Kênh</span>
            <span className="channel-badge">{deviceId}</span>
          </div>

          <div className="channel-actions">
            {liveMode && (
              <span
                className={
                  "latency-pill" +
                  (liveUnavailable ? " latency-pill-error" : "")
                }
              >
                ⏱ {latencyLabel}
              </span>
            )}

            <button
              className="btn btn-ghost ios-btn"
              onClick={openFull}
              disabled={loading || data.length === 0}
            >
              ⛶
            </button>

            {!liveMode && !forceTable && data.length > 0 && (
              <button
                className="btn btn-ghost ios-btn"
                onClick={() => setShowTable((s) => !s)}
              >
                {effectiveTable ? "📈 Biểu đồ" : "📋 Bảng"}
              </button>
            )}

            <button
              className="btn btn-ghost ios-btn"
              onClick={onExportPdf}
              disabled={loading || data.length === 0}
            >
              🧾 PDF
            </button>

            <button
              className="btn btn-primary ios-btn"
              onClick={() => setExportMode("excel")}
              disabled={loading}
            >
              📊 Excel
            </button>
          </div>
        </div>

        {loading && (
          <div className="chart-loading">
            <div className="spinner" /> Đang tải dữ liệu...
          </div>
        )}

        {!loading && data.length > 0 && (
          <>
            {liveMode || !effectiveTable ? (
              <div className="channel-chart__viewport">
                <Chart
                  data={data}
                  tempThresholds={tempThresholds}
                  humThresholds={humThresholds}
                  height="100%"
                />
              </div>
            ) : (
              <HistoryTable data={data} />
            )}
          </>
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

      {full && (
        <div className="chart-fullscreen">
          <div className="chart-fullscreen__backdrop" onClick={closeFull} />
          <div className="chart-fullscreen__panel">
            <div className="chart-fullscreen__topbar">
              <div className="chart-fullscreen__title">
                {deviceId}
                {!landLocked && " • Xoay ngang để xem rõ"}
              </div>

              <div className="chart-fullscreen__actions">
                {count > 1 && (
                  <>
                    <button disabled={!canPrev} onClick={onPrevChannel}>
                      ⟵
                    </button>
                    <button disabled={!canNext} onClick={onNextChannel}>
                      ⟶
                    </button>
                  </>
                )}

                {!liveMode && !forceTable && (
                  <button onClick={() => setFullShowTable((s) => !s)}>
                    {fullShowTable ? "📈" : "📋"}
                  </button>
                )}

                <button onClick={closeFull}>✕</button>
              </div>
            </div>

            <div className="chart-fullscreen__content">
              {fullShowTable && !liveMode ? (
                <HistoryTable data={data} />
              ) : (
                <Chart
                  data={data}
                  tempThresholds={tempThresholds}
                  humThresholds={humThresholds}
                  showBrush
                  isFullscreen
                  height="100%"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
