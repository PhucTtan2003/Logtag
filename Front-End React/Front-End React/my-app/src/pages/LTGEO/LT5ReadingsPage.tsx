import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  fetchAllLt5Serials,
  fetchLt5Readings,
  fetchLt5ReadingsAdmin,
  fetchMyLt5Serials,
} from "../../api/lt5Api";
import Lt5ReadingsTable from "../../components/LTGEO/Lt5ReadingsTable";
import { LtgeoReadingsEnvelope } from "../../models/LtgeoReadings";
import Lt5Chart from "../../components/LTGEO/Lt5Chart";
import { exportToCsv } from "../../utils/exportCsv";
import { exportToExcel } from "../../utils/exportExcel";
import "../../styles/Ltgeo/Lt5ReadingsPage.css";
import Lt5BottomNav from "../../components/LTGEO/Lt5BottomNav";
import api from "../../api/axios";
import { exportTablePdf } from "../../utils/pdf/exportTablePdf";
import { exportChartPdf } from "../../utils/pdf/exportChartPdf";

type RoleMode = "admin" | "user";
type ViewMode = "table" | "chart" | "events";
type RangePreset = "today" | "yesterday" | "7d" | "30d";

function detectMode(pathname: string): RoleMode {
  return pathname.startsWith("/admin/lt5geo") ? "admin" : "user";
}

const normalizeSerial = (v: string) => (v || "").trim().toUpperCase();

const pad = (n: number) => String(n).padStart(2, "0");

function toLocalInputValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function fmtDateTime(input?: any) {
  if (!input) return "—";
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("vi-VN", { hour12: false });
}

function safeNumber(input: any): number | null {
  const n = Number(input);
  return Number.isFinite(n) ? n : null;
}

function getReadingTime(row: any) {
  return (
    row?.timeUtc ??
    row?.timestampUtc ??
    row?.recordedAtUtc ??
    row?.readingTimeUtc ??
    row?.time ??
    row?.timestamp ??
    null
  );
}

function getReadingTemp(row: any) {
  return safeNumber(row?.temperature ?? row?.temperatureC ?? row?.temp ?? row?.value);
}

function eventTypeInfo(event: any) {
  const type = String(event?.type ?? event?.eventType ?? "").toLowerCase();

  if (type.includes("high")) return { icon: "🔥", label: "Cao ngưỡng", cls: "lt5x-event--hot" };
  if (type.includes("low")) return { icon: "❄️", label: "Thấp ngưỡng", cls: "lt5x-event--cold" };
  if (type.includes("battery")) return { icon: "🔋", label: "Pin", cls: "lt5x-event--battery" };
  if (type.includes("loss")) return { icon: "⚠️", label: "Mất nguồn", cls: "lt5x-event--warn" };
  if (type.includes("restore")) return { icon: "🔌", label: "Khôi phục", cls: "lt5x-event--ok" };

  return { icon: "📍", label: event?.type || event?.eventType || "Sự kiện", cls: "lt5x-event--default" };
}

const Lt5ReadingsPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const mode = useMemo(() => detectMode(location.pathname), [location.pathname]);

  // ================== STATE FILTER / RESULT ==================
  const [serialNumber, setSerial] = useState("");
  const [startUtc, setStartUtc] = useState("");
  const [endUtc, setEndUtc] = useState("");
  const [result, setResult] = useState<LtgeoReadingsEnvelope | null>(null);
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const chartRef = useRef<HTMLDivElement | null>(null);

  // ================== SERIAL LIST (Admin: all / User: mine) ==================
  const [serials, setSerials] = useState<string[]>([]);
  const [serialsLoading, setSerialsLoading] = useState(false);
  const hasSerialList = serials.length > 0;

  // ================== EVENTS ==================
  const [events, setEvents] = useState<any[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  // ================== SMS POPUP ==================
  const [smsOpen, setSmsOpen] = useState(false);
  const [smsPhone, setSmsPhone] = useState("");
  const [smsSaving, setSmsSaving] = useState(false);
  const [smsError, setSmsError] = useState<string | null>(null);
  const [smsSuccess, setSmsSuccess] = useState<string | null>(null);

  // ================ Helpers ================
  const hasData = !!result?.data && result.data.length > 0;

  const normalizedSerial = useMemo(() => normalizeSerial(serialNumber), [serialNumber]);

  const timeRange = useMemo(() => {
    return `${startUtc || "…"} → ${endUtc || "…"}`;
  }, [startUtc, endUtc]);

  const filteredSerials = useMemo(() => {
    const keyword = normalizeSerial(serialNumber);
    if (!keyword) return serials.slice(0, 250);
    return serials.filter((s) => s.includes(keyword)).slice(0, 250);
  }, [serialNumber, serials]);

  const readingStats = useMemo(() => {
    const rows = (result?.data ?? []) as any[];
    if (!rows.length) {
      return {
        total: 0,
        firstTime: "—",
        lastTime: "—",
        minTemp: "—",
        maxTemp: "—",
        avgTemp: "—",
      };
    }

    const times = rows
      .map((r) => new Date(getReadingTime(r) ?? ""))
      .filter((d) => !Number.isNaN(d.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());

    const temps = rows.map(getReadingTemp).filter((n): n is number => n != null);
    const min = temps.length ? Math.min(...temps) : null;
    const max = temps.length ? Math.max(...temps) : null;
    const avg = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;

    return {
      total: rows.length,
      firstTime: times[0] ? fmtDateTime(times[0]) : "—",
      lastTime: times[times.length - 1] ? fmtDateTime(times[times.length - 1]) : "—",
      minTemp: min == null ? "—" : `${min.toFixed(1)}°C`,
      maxTemp: max == null ? "—" : `${max.toFixed(1)}°C`,
      avgTemp: avg == null ? "—" : `${avg.toFixed(1)}°C`,
    };
  }, [result]);

  const canFetch = !!normalizedSerial && !loading;

  function applyPreset(preset: RangePreset) {
    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);

    if (preset === "today") {
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 0, 0);
    }

    if (preset === "yesterday") {
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 0, 0);
    }

    if (preset === "7d") {
      start.setDate(start.getDate() - 7);
      start.setHours(0, 0, 0, 0);
    }

    if (preset === "30d") {
      start.setDate(start.getDate() - 30);
      start.setHours(0, 0, 0, 0);
    }

    setStartUtc(toLocalInputValue(start));
    setEndUtc(toLocalInputValue(end));
  }

  // ================== LOAD SERIALS ==================
  async function loadSerials() {
    setSerialsLoading(true);
    setPageError(null);
    try {
      const list = mode === "admin" ? await fetchAllLt5Serials() : await fetchMyLt5Serials();

      const unique = Array.from(
        new Set(
          (list || [])
            .map((s) => (s ?? "").toString().trim().toUpperCase())
            .filter(Boolean)
        )
      ).sort();

      setSerials(unique);

      // Nếu serial hiện tại không còn tồn tại → reset
      if (serialNumber.trim() && !unique.includes(serialNumber.trim().toUpperCase())) {
        setSerial("");
      }
    } catch (err: any) {
      console.error(err);
      setPageError(err?.message || "Không tải được danh sách serial LT5GEO.");
    } finally {
      setSerialsLoading(false);
    }
  }

  useEffect(() => {
    void loadSerials();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ================== LOAD EVENTS ==================
  async function loadEvents() {
    const s = normalizeSerial(serialNumber);
    if (!s) return;

    setLoadingEvents(true);
    setPageError(null);
    try {
      const url = mode === "admin" ? `/api/admin/events/${s}` : `/api/user/events/${s}`;
      const resp = await api.get(url);
      setEvents(Array.isArray(resp.data) ? resp.data : []);
    } catch (err: any) {
      console.error(err);
      setPageError(err?.response?.data?.message || err?.message || "Không tải được sự kiện.");
    } finally {
      setLoadingEvents(false);
    }
  }

  useEffect(() => {
    if (viewMode === "events") void loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, serialNumber, mode]);

  // ================== FETCH READINGS ==================
  async function handleFetch() {
    const s = normalizeSerial(serialNumber);
    if (!s) {
      setPageError("Chưa có serial. Vui lòng chọn hoặc nhập serial LT5GEO.");
      return;
    }

    if (mode === "user" && hasSerialList && !serials.includes(s)) {
      setPageError("Serial không hợp lệ hoặc không thuộc tài khoản này.");
      return;
    }

    setLoading(true);
    setPageError(null);
    try {
      const startIso = startUtc ? new Date(startUtc).toISOString() : null;
      const endIso = endUtc ? new Date(endUtc).toISOString() : null;

      const data =
        mode === "admin"
          ? await fetchLt5ReadingsAdmin({ serialNumber: s, startUtc: startIso, endUtc: endIso })
          : await fetchLt5Readings({ serialNumber: s, startUtc: startIso, endUtc: endIso });

      setSerial(s);
      setResult(data);
      if (viewMode === "events") void loadEvents();
    } catch (err: any) {
      console.error(err);
      setPageError("Lỗi API: " + (err?.message || "Unknown error"));
    } finally {
      setLoading(false);
    }
  }

  // ================== EXPORT PDF ==================
  async function handleExportPdf() {
    if (!result || !hasData) {
      setPageError("Không có dữ liệu để xuất PDF.");
      return;
    }

    const serial = normalizeSerial(serialNumber) || "lt5";
    const range = timeRange;

    if (viewMode === "table") {
      exportTablePdf(result.data, `${serial}-table.pdf`, { serial, timeRange: range });
      return;
    }

    if (viewMode === "chart") {
      if (!chartRef.current) return;

      await exportChartPdf({
        title: "LT5 – LTGeo Readings Viewer",
        subtitle: "Biểu đồ readings",
        meta: [
          { label: "Serial", value: serial },
          { label: "Khoảng thời gian (UTC)", value: range },
          { label: "Tổng readings", value: result.data.length.toLocaleString() },
        ],
        stats: [],
        chartNode: chartRef.current,
        fileName: `${serial}-chart.pdf`,
      });
      return;
    }

    setPageError("PDF hiện tại chỉ hỗ trợ xuất Bảng hoặc Biểu đồ readings.");
  }

  // ================== SAVE PHONE & BẬT SMS LT5GEO ==================
  async function handleSaveLt5Sms() {
    if (!smsPhone.trim()) {
      setSmsError("Vui lòng nhập ít nhất 1 số điện thoại.");
      setSmsSuccess(null);
      return;
    }

    setSmsSaving(true);
    setSmsError(null);
    setSmsSuccess(null);

    try {
      await api.post("/api/sms-activation/lt5", { phone: smsPhone.trim() });
      setSmsSuccess("Đã lưu số điện thoại và bật SMS cho LTGeo.");
      setTimeout(() => setSmsOpen(false), 1200);
    } catch (err: any) {
      console.error(err);
      setSmsError(err?.response?.data?.message || "Không thể lưu. Vui lòng thử lại.");
    } finally {
      setSmsSaving(false);
    }
  }

  // ================== UI helpers ==================
  const backTo = mode === "admin" ? "/admin" : "/user";
  const backLabel = mode === "admin" ? "Quay lại Admin" : "Quay lại User";
  const modeLabel = mode === "admin" ? "Admin Mode" : "User Mode";

  // ================== RENDER ==================
  return (
    <div className="lt5x-page">
      <div className="lt5x-aura lt5x-aura--one" aria-hidden />
      <div className="lt5x-aura lt5x-aura--two" aria-hidden />

      <div className="lt5x-shell">
        <div className="lt5x-topbar">
          <button className="lt5x-btn lt5x-btn--ghost" type="button" onClick={() => navigate(backTo)}>
            <span>←</span> {backLabel}
          </button>

          <div className="lt5x-mode" title="Role mode">
            <span className={`lt5x-live-dot ${mode === "admin" ? "is-admin" : "is-user"}`} />
            {modeLabel}
          </div>
        </div>

        <header className="lt5x-hero">
          <div className="lt5x-hero-main">
            <div className="lt5x-kicker">LTGEO MISSION CONTROL</div>
            <h1>LT5 Readings Intelligence</h1>
            <p>
              {mode === "admin"
                ? "Trung tâm xem dữ liệu LT5GEO cho toàn hệ thống: chọn serial, xem trend, audit sự kiện và xuất báo cáo nhanh."
                : "Không gian theo dõi LT5GEO dành cho người dùng: xem dữ liệu thiết bị được gán, kiểm tra trend và xuất file khi cần."}
            </p>

            <div className="lt5x-hero-actions">
              <button
                type="button"
                className="lt5x-btn lt5x-btn--primary"
                onClick={() => navigate(mode === "admin" ? "/admin/lt5/create-shipment" : "/user/lt5/create-shipment")}
              >
                + Create shipment
              </button>
              <button
                className="lt5x-btn lt5x-btn--violet"
                type="button"
                onClick={() => {
                  setSmsOpen(true);
                  setSmsError(null);
                  setSmsSuccess(null);
                }}
              >
                Bật SMS LTGeo
              </button>
            </div>
          </div>

          <aside className="lt5x-hero-panel">
            <div className="lt5x-orbit">
              <span />
              <b>{hasData ? readingStats.total.toLocaleString() : hasSerialList ? serials.length : 0}</b>
              <small>{hasData ? "readings loaded" : "serials available"}</small>
            </div>
            <div className="lt5x-hero-metrics">
              <span>{serialsLoading ? "Loading serials" : `${serials.length} serials`}</span>
              <span>{viewMode.toUpperCase()}</span>
              <span className={hasData ? "is-ready" : ""}>{hasData ? "Data ready" : "Waiting"}</span>
            </div>
          </aside>
        </header>

        <section className="lt5x-filter-card">
          <div className="lt5x-section-head">
            <div>
              <span className="lt5x-section-kicker">SMART FILTER</span>
              <h2>Chọn thiết bị và khoảng thời gian</h2>
            </div>
            <button className="lt5x-link-btn" type="button" onClick={() => void loadSerials()} disabled={serialsLoading}>
              {serialsLoading ? "Đang tải serial..." : "↻ Làm mới serial"}
            </button>
          </div>

          <div className="lt5x-filter-grid">
            <div className="lt5x-field lt5x-field--serial">
              <label>Serial number</label>
              <div className="lt5x-input-shell">
                <input
                  list={hasSerialList ? "lt5x-serial-options" : undefined}
                  placeholder={serialsLoading ? "Đang tải serial..." : hasSerialList ? "Gõ để tìm serial..." : "VD: LT5-123456"}
                  value={serialNumber}
                  onChange={(e) => setSerial(e.target.value.toUpperCase())}
                  disabled={serialsLoading || (mode === "user" && !hasSerialList)}
                  spellCheck={false}
                />
                {!!serialNumber && (
                  <button type="button" aria-label="Xóa serial" onClick={() => setSerial("")}>
                    ×
                  </button>
                )}
              </div>
              {hasSerialList && (
                <datalist id="lt5x-serial-options">
                  {filteredSerials.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              )}
            </div>

            <div className="lt5x-field">
              <label>Từ ngày</label>
              <input type="datetime-local" value={startUtc} onChange={(e) => setStartUtc(e.target.value)} />
            </div>

            <div className="lt5x-field">
              <label>Đến ngày</label>
              <input type="datetime-local" value={endUtc} onChange={(e) => setEndUtc(e.target.value)} />
            </div>

            <div className="lt5x-fetch-box">
              <button className="lt5x-btn lt5x-btn--primary lt5x-btn--wide" onClick={handleFetch} disabled={!canFetch} type="button">
                {loading ? "Đang tải..." : "Tải dữ liệu"}
              </button>
            </div>
          </div>

          <div className="lt5x-preset-row" aria-label="Bộ lọc nhanh">
            <button type="button" onClick={() => applyPreset("today")}>Hôm nay</button>
            <button type="button" onClick={() => applyPreset("yesterday")}>Hôm qua</button>
            <button type="button" onClick={() => applyPreset("7d")}>7 ngày</button>
            <button type="button" onClick={() => applyPreset("30d")}>30 ngày</button>
          </div>
        </section>

        {pageError && <div className="lt5x-alert">{pageError}</div>}

        {!result && (
          <section className="lt5x-empty-start">
            <div className="lt5x-empty-icon">📡</div>
            <h3>Sẵn sàng tải readings</h3>
            <p>Chọn serial, chọn khoảng thời gian rồi bấm “Tải dữ liệu”. Giao diện sẽ tự chuyển sang bảng, biểu đồ hoặc sự kiện.</p>
          </section>
        )}

        {result && (
          <section className="lt5x-result-card">
            <div className="lt5x-result-top">
              <div>
                <span className="lt5x-section-kicker">READINGS RESULT</span>
                <h2>Kết quả dữ liệu</h2>
                <p>
                  Status: <b>{result.status || "—"}</b> • Timestamp: <b>{result.timestampUtc || "—"}</b>
                </p>
              </div>

              {hasData && (
                <div className="lt5x-export-group">
                  <button className="lt5x-btn lt5x-btn--ghost" type="button" onClick={() => exportToCsv("lt5_readings.csv", result.data)}>
                    CSV
                  </button>
                  <button className="lt5x-btn lt5x-btn--ghost" type="button" onClick={() => exportToExcel("lt5_readings.xlsx", result.data)}>
                    Excel
                  </button>
                  <button className="lt5x-btn lt5x-btn--dark" type="button" onClick={handleExportPdf}>
                    PDF
                  </button>
                </div>
              )}
            </div>

            {hasData ? (
              <>
                <div className="lt5x-stats-grid">
                  <div className="lt5x-stat-card is-main">
                    <span>Tổng readings</span>
                    <b>{readingStats.total.toLocaleString()}</b>
                  </div>
                  <div className="lt5x-stat-card">
                    <span>Serial</span>
                    <b>{normalizedSerial || "—"}</b>
                  </div>
                  <div className="lt5x-stat-card">
                    <span>Min / Max</span>
                    <b>{readingStats.minTemp} / {readingStats.maxTemp}</b>
                  </div>
                  <div className="lt5x-stat-card">
                    <span>Trung bình</span>
                    <b>{readingStats.avgTemp}</b>
                  </div>
                  <div className="lt5x-stat-card span-2">
                    <span>Khoảng dữ liệu</span>
                    <b>{readingStats.firstTime} → {readingStats.lastTime}</b>
                  </div>
                </div>

                <div className="lt5x-viewbar">
                  <div className="lt5x-tabs" role="tablist" aria-label="Chọn dạng xem">
                    <button type="button" className={viewMode === "table" ? "active" : ""} onClick={() => setViewMode("table")}>Bảng</button>
                    <button type="button" className={viewMode === "chart" ? "active" : ""} onClick={() => setViewMode("chart")}>Biểu đồ</button>
                    <button type="button" className={viewMode === "events" ? "active" : ""} onClick={() => setViewMode("events")}>Sự kiện</button>
                  </div>
                  <div className="lt5x-tip">Tip: biểu đồ để nhìn trend, sự kiện để audit cảnh báo, bảng để xuất dữ liệu chi tiết.</div>
                </div>

                <div className="lt5x-content">
                  {viewMode === "table" && (
                    <div className="lt5x-table-mount">
                      <Lt5ReadingsTable readings={result.data} />
                    </div>
                  )}

                  {viewMode === "chart" && (
                    <div ref={chartRef} className="lt5x-chart-frame">
                      <Lt5Chart readings={result.data} />
                    </div>
                  )}

                  {viewMode === "events" && (
                    <div className="lt5x-events-panel">
                      <div className="lt5x-events-head">
                        <div>
                          <h3>Sự kiện gần đây</h3>
                          <p>Audit cảnh báo, pin, nguồn và các biến động liên quan serial đang chọn.</p>
                        </div>
                        <button type="button" className="lt5x-link-btn" onClick={() => void loadEvents()} disabled={loadingEvents}>
                          {loadingEvents ? "Đang tải..." : `↻ ${events.length} sự kiện`}
                        </button>
                      </div>

                      {loadingEvents && <p className="lt5x-loading">Đang tải sự kiện...</p>}

                      {!loadingEvents && events.length === 0 && <p className="lt5x-empty-line">Không có sự kiện nào cho serial này.</p>}

                      {!loadingEvents && events.length > 0 && (
                        <div className="lt5x-event-list">
                          {events.map((e, idx) => {
                            const info = eventTypeInfo(e);
                            return (
                              <article key={`${e.timeUtc || e.eventTimeUtc || idx}-${idx}`} className={`lt5x-event-card ${info.cls}`}>
                                <div className="lt5x-event-icon">{info.icon}</div>
                                <div className="lt5x-event-body">
                                  <div className="lt5x-event-title-row">
                                    <h4>{e.type || e.eventType || info.label}</h4>
                                    <span>{fmtDateTime(e.timeUtc || e.eventTimeUtc || e.time)}</span>
                                  </div>
                                  <div className="lt5x-event-meta">
                                    <span>Giá trị: <b>{e.value ?? e.alarmValue ?? "—"}°C</b></span>
                                    <span>Ngưỡng: <b>{e.threshold ?? e.alarmThreshold ?? "—"}°C</b></span>
                                  </div>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="lt5x-empty-result">
                <div>🛰️</div>
                <h3>Không có dữ liệu trong khoảng thời gian đã chọn</h3>
                <p>Thử nới rộng khoảng thời gian hoặc kiểm tra lại serial.</p>
              </div>
            )}
          </section>
        )}

        {/* Bottom nav giữ logic cũ */}
        {hasData && viewMode !== "events" && (
          <Lt5BottomNav viewMode={viewMode === "chart" ? "chart" : "table"} onChange={(m) => setViewMode(m)} />
        )}
      </div>

      {/* POPUP SMS */}
      {smsOpen && (
        <div className="lt5x-modal-overlay" onClick={() => !smsSaving && setSmsOpen(false)}>
          <div className="lt5x-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="lt5x-modal-head">
              <div>
                <span className="lt5x-section-kicker">SMS LTGEO</span>
                <h3>Kích hoạt SMS cho LTGeo</h3>
              </div>
              <button type="button" onClick={() => setSmsOpen(false)} disabled={smsSaving} aria-label="Đóng">
                ×
              </button>
            </div>

            <p>
              Nhập số điện thoại nhận cảnh báo. Có thể nhập nhiều số, cách nhau bằng dấu phẩy, khoảng trắng hoặc dấu chấm phẩy.
            </p>

            <textarea
              className="lt5x-sms-input"
              placeholder="VD: 0912..., 0836..."
              value={smsPhone}
              onChange={(e) => setSmsPhone(e.target.value)}
              rows={3}
            />

            {smsError && <div className="lt5x-modal-msg is-error">{smsError}</div>}
            {smsSuccess && <div className="lt5x-modal-msg is-success">{smsSuccess}</div>}

            <div className="lt5x-modal-actions">
              <button type="button" className="lt5x-btn lt5x-btn--ghost" onClick={() => setSmsOpen(false)} disabled={smsSaving}>
                Đóng
              </button>
              <button type="button" className="lt5x-btn lt5x-btn--primary" onClick={handleSaveLt5Sms} disabled={smsSaving}>
                {smsSaving ? "Đang lưu..." : "Lưu & Bật SMS"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Lt5ReadingsPage;
