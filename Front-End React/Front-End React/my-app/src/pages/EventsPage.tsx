// src/pages/EventsPage.tsx

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useNavigate } from "react-router-dom";

import "../styles/EventsPage.css";

import "../styles/Exports/eventsExport.css";

import type { DbEvent, LogTagEventsResponse } from "../lib/events/types";

import { formatYMDHMS, tzShort, toIsoSeconds } from "../lib/events/format";

import { humanText } from "../lib/events/classify";

import EventDetailPanel from "../components/EventDetailPanel";

import { useEventsRealtime, type LiveAlertDto } from "../hooks/useEventsRealtime";

import {

  exportEventsToExcel,

  exportEventsToPdf,

  type EventExportMeta,

} from "../lib/events/eventExport";



const API_BASE = process.env.REACT_APP_API_BASE_URL || "";

const api = (p: string) => `${API_BASE.replace(/\/+$/, "")}${p}`;



const LAST_SERIAL_KEY = "events:lastSerial";

const MAX_RENDER_ROWS = 1200;

const MAX_EXPORT_DAYS = 92;

const CLOUD_EXPORT_CHUNK_DAYS = 30;



type EventTone = "alarm" | "battery" | "connection" | "info";

type QuickRange = "1h" | "6h" | "24h" | "7d" | "30d" | "60d" | "90d";



type DbEventLite = Pick<DbEvent, "serialNumber" | "eventType" | "eventTimeUtc">;



/** Map LiveAlertDto -> DbEvent tối thiểu để append realtime vào bảng. */

function deriveEventType(msg: string): string {

  if (/battery|pin/i.test(msg)) return "battery";

  if (/connect(ed|ion|lost|offline)|disconnect|mất kết nối/i.test(msg)) return "connection";

  if (/alarm|temperature|humidity|vượt ngưỡng|nhiệt độ|độ ẩm/i.test(msg)) return "alarm";

  return "info";

}



function alertToDbEvent(a: LiveAlertDto): DbEvent {

  const raw = a as any;

  const message = String(raw.message ?? raw.Message ?? "");



  const e: DbEventLite = {

    serialNumber: String(raw.serialNumber ?? raw.SerialNumber ?? "").toUpperCase(),

    eventType: deriveEventType(message),

    eventTimeUtc: raw.timeUtc ?? raw.TimeUtc ?? new Date().toISOString(),

  };



  return e as DbEvent;

}



function toneOf(eventType?: string): EventTone {

  const t = String(eventType || "").toLowerCase();

  if (t.includes("battery")) return "battery";

  if (t.includes("connect") || t.includes("disconnect") || t.includes("offline")) return "connection";

  if (t.includes("alarm") || t.includes("temperature") || t.includes("humidity")) return "alarm";

  return "info";

}



function isSameEvent(a: DbEvent, b: DbEvent) {

  return (

    String(a.serialNumber).toUpperCase() === String(b.serialNumber).toUpperCase() &&

    String(a.eventType) === String(b.eventType) &&

    String(a.eventTimeUtc) === String(b.eventTimeUtc)

  );

}



function toLocalInputValue(d: Date) {

  const pad = (n: number) => String(n).padStart(2, "0");

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

}



function validDate(value: unknown): Date | null {

  if (!value) return null;

  const d = new Date(value as any);

  return Number.isFinite(d.getTime()) ? d : null;

}



function safeLocalTime(value: unknown) {

  const d = validDate(value);

  if (!d) return "—";

  return `${formatYMDHMS(d)} ${tzShort(d)}`;

}



function safeUtcPlus7Time(value: unknown) {

  const d = validDate(value);

  if (!d) return "—";



  return new Intl.DateTimeFormat("sv-SE", {

    timeZone: "Asia/Ho_Chi_Minh",

    year: "numeric",

    month: "2-digit",

    day: "2-digit",

    hour: "2-digit",

    minute: "2-digit",

    second: "2-digit",

    hour12: false,

  }).format(d).replace(" ", " ");

}



function cleanRepeatText(input?: string | null) {
  if (!input) return "";
  return String(input)
    .replace(/\s*,?\s*lặp\s+\d+\s+lần\.?/gi, "")
    .replace(/\s*,?\s*lập\s+\d+\s+lần\.?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}



function StatCard({ icon, label, value, hint, tone }: {

  icon: string;

  label: string;

  value: React.ReactNode;

  hint?: string;

  tone?: EventTone | "live";

}) {

  return (

    <div className={`ep-stat ${tone ? `ep-stat--${tone}` : ""}`}>

      <div className="ep-statIcon">{icon}</div>

      <div>

        <div className="ep-statLabel">{label}</div>

        <div className="ep-statValue">{value}</div>

        {hint && <div className="ep-statHint">{hint}</div>}

      </div>

    </div>

  );

}



export default function EventsPage() {

  const navigate = useNavigate();

  const requestSeq = useRef(0);



  const [serials, setSerials] = useState<string[]>([]);

  const [serial, setSerial] = useState<string>("");

  const [rows, setRows] = useState<DbEvent[]>([]);

  const [refreshResp, setRefreshResp] = useState<LogTagEventsResponse | null>(null);



  const [start, setStart] = useState<string>("");

  const [end, setEnd] = useState<string>("");

  const [search, setSearch] = useState<string>("");

  const [typeFilter, setTypeFilter] = useState<string>("all");



  const [loading, setLoading] = useState(false);

  const [cloudLoading, setCloudLoading] = useState(false);

  const [exporting, setExporting] = useState<"excel" | "pdf" | null>(null);

  const [syncBeforeExport, setSyncBeforeExport] = useState(true);

  const [exportStatus, setExportStatus] = useState("");

  const [err, setErr] = useState("");

  const [selected, setSelected] = useState<DbEvent | null>(null);



  const startDate = useMemo(() => (start ? new Date(start) : undefined), [start]);

  const endDate = useMemo(() => (end ? new Date(end) : undefined), [end]);



  const viewSaved = useCallback(async (sn: string, sDate?: Date, eDate?: Date) => {

    if (!sn) {

      setErr("Chọn thiết bị trước.");

      return;

    }



    const seq = ++requestSeq.current;

    setErr("");

    setLoading(true);



    try {

      const r = await fetch(api("/api/user/events/query"), {

        method: "POST",

        credentials: "include",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({

          serialNumber: sn,

          startDateUtc: toIsoSeconds(sDate),

          endDateUtc: toIsoSeconds(eDate),

          limit: 50000,

        }),

      });



      if (!r.ok) throw new Error(await r.text());

      const { data } = await r.json();



      if (seq === requestSeq.current) {

        setRows(Array.isArray(data) ? data : []);

        setRefreshResp(null);

      }

    } catch (e: any) {

      if (seq === requestSeq.current) setErr(e?.message || "Lỗi không xác định");

    } finally {

      if (seq === requestSeq.current) setLoading(false);

    }

  }, []);



  // Lần đầu: tải danh sách serial, ưu tiên serial đã xem gần nhất.

  useEffect(() => {

    let alive = true;



    (async () => {

      try {

        const r = await fetch(api("/api/user/my-serials"), { credentials: "include" });

        if (!r.ok) throw new Error(await r.text());



        const json = await r.json();

        const list: string[] = Array.isArray(json?.serials) ? json.serials : [];

        const clean = list

          .map((s) => String(s || "").trim().toUpperCase())

          .filter(Boolean);



        if (!alive) return;



        setSerials(clean);



        const saved = localStorage.getItem(LAST_SERIAL_KEY) || "";

        const first = clean.find((s) => s === saved) || clean[0] || "";

        setSerial(first);

      } catch (e: any) {

        if (alive) setErr(e?.message || "Không tải được danh sách thiết bị.");

      }

    })();



    return () => {

      alive = false;

    };

  }, []);



  // Khi đổi serial hoặc đổi khoảng thời gian thì chỉ query dữ liệu, không reload danh sách serial nữa.

  useEffect(() => {

    if (!serial) return;

    localStorage.setItem(LAST_SERIAL_KEY, serial);

    viewSaved(serial, startDate, endDate);

  }, [serial, startDate, endDate, viewSaved]);



  const handleRealtimeAlert = useCallback((payload: LiveAlertDto | LiveAlertDto[]) => {

    const arr = Array.isArray(payload) ? payload : [payload];

    if (!arr.length) return;



    const current = serial.trim().toUpperCase();

    const mapped = arr

      .map(alertToDbEvent)

      .filter((e) => !current || String(e.serialNumber).toUpperCase() === current);



    if (!mapped.length) return;



    setRows((prev) => {

      const next = [...prev];

      for (const e of mapped) {

        if (!next.some((x) => isSameEvent(x, e))) next.unshift(e);

      }

      return next;

    });

  }, [serial]);



  // ⚡ Realtime: nhận ReceiveAlert từ hub → prepend đúng serial đang xem.

  useEventsRealtime({

    role: "user",

    onAlert: handleRealtimeAlert,

  });



  const refreshFromCloud = async () => {

    if (!serial) return setErr("Chọn thiết bị trước.");

    if (startDate && endDate && (+endDate - +startDate) / 86400000 > 31.5) {

      return setErr("Khoảng thời gian không vượt quá 1 tháng.");

    }



    setErr("");

    setCloudLoading(true);



    try {

      const r = await fetch(api("/api/user/events/fetch"), {

        method: "POST",

        credentials: "include",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({

          serialNumber: serial,

          startDateUtc: toIsoSeconds(startDate),

          endDateUtc: toIsoSeconds(endDate),

        }),

      });



      if (!r.ok) throw new Error(await r.text());

      const resp = (await r.json()) as LogTagEventsResponse;

      setRefreshResp(resp);

      await viewSaved(serial, startDate, endDate);

    } catch (e: any) {

      setErr(e?.message || "Lỗi không xác định");

    } finally {

      setCloudLoading(false);

    }

  };



  const setQuickRange = (range: QuickRange) => {

    const now = new Date();

    const from = new Date(now);



    if (range === "1h") from.setHours(now.getHours() - 1);

    if (range === "6h") from.setHours(now.getHours() - 6);

    if (range === "24h") from.setDate(now.getDate() - 1);

    if (range === "7d") from.setDate(now.getDate() - 7);

    if (range === "30d") from.setDate(now.getDate() - 30);

    if (range === "60d") from.setDate(now.getDate() - 60);

    if (range === "90d") from.setDate(now.getDate() - 90);



    setStart(toLocalInputValue(from));

    setEnd(toLocalInputValue(now));

  };



  const clearRange = () => {

    setStart("");

    setEnd("");

  };



  const getExportRange = (): { from: Date; to: Date } | null => {

    if (!serial) {

      setErr("Chọn thiết bị trước khi xuất file.");

      return null;

    }



    if (!startDate || !endDate) {

      setErr("Vui lòng chọn đầy đủ thời gian Từ và Đến để xuất file.");

      return null;

    }



    if (+endDate <= +startDate) {

      setErr("Thời gian Đến phải lớn hơn thời gian Từ.");

      return null;

    }



    const totalDays = (+endDate - +startDate) / 86400000;

    if (totalDays > MAX_EXPORT_DAYS) {

      setErr(`Khoảng xuất tối đa ${MAX_EXPORT_DAYS} ngày, tương đương khoảng 3 tháng.`);

      return null;

    }



    return { from: startDate, to: endDate };

  };



  const syncCloudForExport = async (from: Date, to: Date) => {

    const chunkMs = CLOUD_EXPORT_CHUNK_DAYS * 86400000;

    const totalChunks = Math.ceil((+to - +from) / chunkMs);

    let cursor = new Date(from);

    let chunkIndex = 0;



    while (+cursor < +to) {

      chunkIndex += 1;

      const next = new Date(Math.min(+cursor + chunkMs, +to));

      setExportStatus(`Đang đồng bộ LogTag cloud ${chunkIndex}/${totalChunks}...`);



      const response = await fetch(api("/api/user/events/fetch"), {

        method: "POST",

        credentials: "include",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({

          serialNumber: serial,

          startDateUtc: toIsoSeconds(cursor),

          endDateUtc: toIsoSeconds(next),

        }),

      });



      if (!response.ok) {

        throw new Error(await response.text());

      }



      cursor = next;

    }

  };



  const loadRowsForExport = async (from: Date, to: Date): Promise<DbEvent[]> => {

    if (syncBeforeExport) {

      await syncCloudForExport(from, to);

    }



    setExportStatus("Đang lấy dữ liệu sự kiện để tạo file...");



    const response = await fetch(api("/api/user/events/query"), {

      method: "POST",

      credentials: "include",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({

        serialNumber: serial,

        startDateUtc: toIsoSeconds(from),

        endDateUtc: toIsoSeconds(to),

        limit: 100000,

      }),

    });



    if (!response.ok) {

      throw new Error(await response.text());

    }



    const json = await response.json();

    const exportRows = Array.isArray(json?.data) ? (json.data as DbEvent[]) : [];



    if (!exportRows.length) {

      throw new Error("Không có sự kiện trong khoảng thời gian đã chọn.");

    }



    return exportRows;

  };



  const buildExportMeta = (from: Date, to: Date): EventExportMeta => ({

    serialNumber: serial,

    startUtc: from,

    endUtc: to,

  });



  const handleExportExcel = async () => {

    const range = getExportRange();

    if (!range) return;



    setErr("");

    setExporting("excel");

    setExportStatus("Chuẩn bị xuất Excel...");



    try {

      const exportRows = await loadRowsForExport(range.from, range.to);

      exportEventsToExcel(exportRows, buildExportMeta(range.from, range.to));

      setExportStatus(`Đã xuất Excel với ${exportRows.length} sự kiện.`);

      setRows(exportRows);

    } catch (e: any) {

      setErr(e?.message || "Xuất Excel thất bại.");

      setExportStatus("");

    } finally {

      setExporting(null);

    }

  };



  const handleExportPdf = async () => {

    const range = getExportRange();

    if (!range) return;



    setErr("");

    setExporting("pdf");

    setExportStatus("Đang tạo file PDF có thương hiệu...");



    try {

      const exportRows = await loadRowsForExport(range.from, range.to);

      await exportEventsToPdf(

        exportRows,

        buildExportMeta(range.from, range.to)

      );

      setExportStatus(`Đã lưu PDF với ${exportRows.length} sự kiện.`);

      setRows(exportRows);

    } catch (e: any) {

      setErr(e?.message || "Xuất PDF thất bại.");

      setExportStatus("");

    } finally {

      setExporting(null);

    }

  };



  const stats = useMemo(() => {

    const counts = rows.reduce(

      (acc, r) => {

        acc[toneOf(r.eventType)] += 1;

        return acc;

      },

      { alarm: 0, battery: 0, connection: 0, info: 0 } as Record<EventTone, number>

    );



    const latest = rows.reduce<DbEvent | null>((best, item) => {

      if (!best) return item;

      const a = validDate(best.eventTimeUtc)?.getTime() ?? 0;

      const b = validDate(item.eventTimeUtc)?.getTime() ?? 0;

      return b > a ? item : best;

    }, null);



    return { ...counts, latest };

  }, [rows]);



  const eventTypes = useMemo(() => {

    const set = new Set(rows.map((r) => String(r.eventType || "info")));

    return Array.from(set).sort((a, b) => a.localeCompare(b));

  }, [rows]);



  const filteredRows = useMemo(() => {

    const q = search.trim().toLowerCase();



    return rows.filter((r) => {

      const type = String(r.eventType || "info");

      if (typeFilter !== "all" && type !== typeFilter) return false;



      if (!q) return true;



      const info = humanText(r);

      return [

        r.serialNumber,

        r.eventType,

        r.eventTimeUtc,

        info.title,

        info.detail,

      ]

        .map((x) => String(x || "").toLowerCase())

        .some((x) => x.includes(q));

    });

  }, [rows, search, typeFilter]);



  const visibleRows = useMemo(() => filteredRows.slice(0, MAX_RENDER_ROWS), [filteredRows]);



  return (

    <div className="ep-wrap">

      <section className="ep-hero">

        <div className="ep-heroText">

          <div className="ep-kicker"><span /> EVENT MONITORING</div>

          <h2 className="ep-h2">Trung tâm sự kiện & cảnh báo</h2>

          <p className="ep-sub">

            Giám sát các sự kiện theo thiết bị và thời gian. Dữ liệu đã lưu được tải trước; chỉ đồng bộ cloud khi bạn yêu cầu.

          </p>

        </div>



        <div className="ep-heroStats">

          <StatCard icon="📡" label="Serial" value={serial || "—"} hint={`${serials.length} thiết bị được gán`} tone="live" />

          <StatCard icon="🚨" label="Cảnh báo" value={stats.alarm} hint="trong bảng hiện tại" tone="alarm" />

          <StatCard icon="🔋" label="Pin" value={stats.battery} hint="battery events" tone="battery" />

          <StatCard icon="🕒" label="Mới nhất" value={stats.latest ? safeLocalTime(stats.latest.eventTimeUtc) : "—"} hint="giờ local" />

        </div>

      </section>



      <div className="ep-shell">

        <aside className="ep-panel">

          <div className="ep-panelHead">

            <div>

              <div className="ep-panelLabel">BỘ LỌC SỰ KIỆN</div>

              <h3>Bộ lọc & truy vấn</h3>

            </div>

            <button className="ep-btnBack" onClick={() => navigate("/user")}>← Tổng quan</button>

          </div>



          <div className="ep-field">

            <label className="ep-label">Thiết bị</label>

            <select

              title="Thiết bị"

              value={serial}

              onChange={(e) => setSerial(e.target.value)}

              className="ep-input"

            >

              {!serials.length && <option value="">Không có thiết bị</option>}

              {serials.map((s) => <option key={s} value={s}>{s}</option>)}

            </select>

          </div>



          <div className="ep-grid ep-grid--panel">

            <div className="ep-field">

              <label className="ep-label">Từ</label>

              <input

                title="Ngày bắt đầu"

                type="datetime-local"

                value={start}

                onChange={(e) => setStart(e.target.value)}

                className="ep-input"

              />

            </div>

            <div className="ep-field">

              <label className="ep-label">Đến</label>

              <input

                title="Ngày kết thúc"

                type="datetime-local"

                value={end}

                onChange={(e) => setEnd(e.target.value)}

                className="ep-input"

              />

            </div>

          </div>



          <div className="ep-quickRanges" aria-label="Chọn nhanh khoảng thời gian">

            <button type="button" onClick={() => setQuickRange("1h")}>1 giờ</button>

            <button type="button" onClick={() => setQuickRange("6h")}>6 giờ</button>

            <button type="button" onClick={() => setQuickRange("24h")}>24 giờ</button>

            <button type="button" onClick={() => setQuickRange("7d")}>7 ngày</button>

            <button type="button" onClick={() => setQuickRange("30d")}>30 ngày</button>

            <button type="button" onClick={() => setQuickRange("60d")}>60 ngày</button>

            <button type="button" onClick={() => setQuickRange("90d")}>90 ngày</button>

            <button type="button" onClick={clearRange}>Tất cả</button>

          </div>



          <div className="ep-actions ep-actions--panel">

            <button onClick={refreshFromCloud} disabled={loading || cloudLoading || !serial} className="ep-btn ep-btn--alt">

              {cloudLoading ? "Đang kéo LogTag…" : "Kéo LogTag cloud"}

            </button>

            <button onClick={() => serial && viewSaved(serial, startDate, endDate)} disabled={loading || !serial} className="ep-btn ep-btn--ghost">

              {loading ? "Đang tải…" : "Xem dữ liệu lưu"}

            </button>

          </div>



          <details className="ep-exportBox"><summary>Xuất Excel / PDF <span>Chọn để mở công cụ xuất báo cáo</span></summary>

            <h4 className="ep-exportTitle">Xuất báo cáo sự kiện</h4>

            <p className="ep-exportHint">

              Dùng khoảng thời gian Từ - Đến ở phía trên. Tối đa {MAX_EXPORT_DAYS} ngày.

            </p>



            <label className="ep-exportSync">

              <input

                type="checkbox"

                checked={syncBeforeExport}

                onChange={(e) => setSyncBeforeExport(e.target.checked)}

                disabled={!!exporting}

              />

              <span>Đồng bộ LogTag cloud theo từng đợt 30 ngày trước khi xuất.</span>

            </label>



            <div className="ep-exportButtons">

              <button

                type="button"

                className="ep-btn ep-btn--alt"

                onClick={handleExportExcel}

                disabled={!!exporting || loading || cloudLoading || !serial}

              >

                {exporting === "excel" ? "Đang xuất Excel…" : "📊 Xuất Excel"}

              </button>



              <button

                type="button"

                className="ep-btn ep-btn--ghost"

                onClick={handleExportPdf}

                disabled={!!exporting || loading || cloudLoading || !serial}

              >

                {exporting === "pdf" ? "Đang tạo PDF…" : "🧾 Lưu PDF"}

              </button>

            </div>



            {exportStatus && <p className="ep-exportStatus">{exportStatus}</p>}

            <p className="ep-exportHint">

              PDF sẽ lưu trực tiếp thành file có bố cục báo cáo riêng; Excel sẽ nhẹ và dễ lọc dữ liệu hơn khi số dòng lớn.

            </p>

          </details>



          <div className="ep-liveBox">

            <span className="ep-liveDot" />

            <div>

              <b>Realtime đang nghe</b>

              <p>Alert mới sẽ tự chèn lên đầu bảng nếu đúng serial đang chọn.</p>

            </div>

          </div>

        </aside>



        <main className="ep-card">

          {err && <div className="ep-err">{err}</div>}



          {!!refreshResp && (

            <details className="ep-details">

              <summary>Chi tiết lần làm mới gần nhất</summary>

              <pre>{JSON.stringify(refreshResp, null, 2)}</pre>

            </details>

          )}



          <div className="ep-tableTop">

            <div>

              <div className="ep-total">Tổng: <b>{rows.length}</b> bản ghi</div>

              <h3 className="ep-tableTitle">Event timeline</h3>

              <p className="ep-tableSub">

                Đang hiển thị <b>{visibleRows.length}</b> / {filteredRows.length} dòng sau lọc.

              </p>

            </div>



            <div className="ep-tools">

              <input

                className="ep-input ep-search"

                value={search}

                onChange={(e) => setSearch(e.target.value)}

                placeholder="Tìm serial, loại, nội dung..."

              />

              <select

                className="ep-input ep-typeSelect"

                value={typeFilter}

                onChange={(e) => setTypeFilter(e.target.value)}

                title="Lọc loại sự kiện"

              >

                <option value="all">Tất cả loại</option>

                {eventTypes.map((t) => <option key={t} value={t}>{t}</option>)}

              </select>

            </div>

          </div>



          <div className="ep-miniStats" aria-label="Thống kê theo nhóm sự kiện">

            <StatCard icon="🚨" label="Alarm" value={stats.alarm} tone="alarm" />

            <StatCard icon="🔋" label="Battery" value={stats.battery} tone="battery" />

            <StatCard icon="📶" label="Connection" value={stats.connection} tone="connection" />

            <StatCard icon="ℹ️" label="Info" value={stats.info} tone="info" />

          </div>



          <div className="ep-tableWrap">

            {loading ? (

              <div className="ep-loading">

                <span className="ep-spinner" />

                Đang tải sự kiện…

              </div>

            ) : (

              <table className="ep-table">

                <colgroup>

                  <col className="ep-col-time" />

                  <col className="ep-col-device" />

                  <col className="ep-col-title" />

                  <col className="ep-col-detail" />

                  <col className="ep-col-action" />

                </colgroup>

                <thead>

                  <tr>

                    <th>Thời gian UTC+7</th>

                    <th>Thiết bị</th>

                    <th>Sự kiện</th>

                    <th>Diễn giải</th>

                    <th></th>

                  </tr>

                </thead>

                <tbody>

                  {visibleRows.map((r, i) => {

                    const info = humanText(r);

                    const tone = toneOf(r.eventType);

                    const dt = validDate(r.eventTimeUtc);

                    const local = dt ? formatYMDHMS(dt) : "—";

                    const tz = dt ? tzShort(dt) : "";

                    const detail = cleanRepeatText(info.detail || "-");



                    return (

                      <tr key={`${r.serialNumber}-${r.eventType}-${r.eventTimeUtc}-${i}`}>

                        <td title={`UTC: ${dt ? formatYMDHMS(dt, "UTC") : "—"} UTC`} className="ep-mono">{safeUtcPlus7Time(r.eventTimeUtc)}</td>

                        <td className="ep-mono ep-serialCell">{r.serialNumber}</td>

                        <td>

                          <div className="ep-titleRow">

                            <span className="ep-emoji">{info.icon}</span>

                            <span className="ep-titleText">{info.title}</span>

                          </div>

                          <div className="ep-chipWrap">

                            <span className={`ep-chip ep-chip--${tone}`}>{r.eventType || "info"}</span>

                          </div>

                        </td>

                        <td className="ep-detail">{detail || "-"}</td>

                        <td><button className="ep-link" onClick={() => setSelected(r)}>Xem chi tiết</button></td>

                      </tr>

                    );

                  })}

                  {!visibleRows.length && <tr><td colSpan={5} className="ep-empty">Không có dữ liệu</td></tr>}

                </tbody>

              </table>

            )}

          </div>

        </main>

      </div>



      <EventDetailPanel event={selected} onClose={() => setSelected(null)} />

    </div>

  );

}
