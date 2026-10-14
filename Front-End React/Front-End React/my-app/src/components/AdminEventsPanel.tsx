import React, { useMemo, useState } from "react";
import "../styles/Admin/AdminEventsPanel.css";
import "../styles/EventsPage.css";
import type { DbEvent, LogTagEventsResponse } from "../lib/events/types";
import { formatYMDHMS, tzShort, toIsoSeconds, relTime } from "../lib/events/format";
import { humanText } from "../lib/events/classify";
import EventDetailPanel from "../components/EventDetailPanel";
import { useEventsRealtime, type LiveAlertDto } from "../hooks/useEventsRealtime";

const API_BASE = process.env.REACT_APP_API_BASE_URL || "";
const api = (p: string) => `${API_BASE.replace(/\/+$/, "")}${p}`;

// ===== Helpers: map LiveAlertDto -> DbEvent =====
function deriveEventType(msg: string): string {
  if (/battery/i.test(msg)) return "battery";
  if (/connect(ed|ion|lost|offline)/i.test(msg)) return "connection";
  if (/alarm|temperature|humidity|vượt ngưỡng/i.test(msg)) return "alarm";
  return "info";
}

function alertToDbEvent(a: LiveAlertDto): DbEvent {
  const eventType = deriveEventType(a.message || "");
  const e: Partial<DbEvent> = {
    serialNumber: a.serialNumber,
    eventType,
    eventTimeUtc: a.timeUtc,
    // tuỳ lib/classify: nếu có raw/payload, nhét message/notes để hiển thị chi tiết
  };
  // ép kiểu mềm để tránh TS lỗi nếu DbEvent có field bắt buộc khác
  return e as DbEvent;
}

export default function AdminEventsPanel() {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [eventType, setEventType] = useState("");
  const [rows, setRows] = useState<DbEvent[]>([]);
  const [serialToFetch, setSerialToFetch] = useState("");
  const [lastFetch, setLastFetch] = useState<LogTagEventsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState<DbEvent | null>(null);

  const dStart = start ? new Date(start) : undefined;
  const dEnd = end ? new Date(end) : undefined;

  const groups = useMemo(() => {
    const g: Record<string, DbEvent[]> = {};
    for (const r of rows) {
      const day = new Date(r.eventTimeUtc).toISOString().slice(0, 10);
      (g[day] ??= []).push(r);
    }
    Object.values(g).forEach(list =>
      list.sort((a, b) => +new Date(b.eventTimeUtc) - +new Date(a.eventTimeUtc))
    );
    return Object.entries(g).sort(([a], [b]) => (a < b ? 1 : -1));
  }, [rows]);

  const loadAll = async () => {
    setErr(""); setLoading(true);
    try {
      const r = await fetch(api("/api/admin/events/query-all"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDateUtc: toIsoSeconds(dStart),
          endDateUtc: toIsoSeconds(dEnd),
          eventType: eventType.trim() || undefined,
          limit: 100000
        })
      });
      if (!r.ok) throw new Error(await r.text());
      const { data } = await r.json();
      setRows((data || []) as DbEvent[]);
    } catch (e: any) {
      setErr(e?.message || "Lỗi không xác định");
    } finally {
      setLoading(false);
    }
  };

  const fetchOne = async () => {
    if (!serialToFetch.trim()) return setErr("Nhập serial muốn kéo.");
    if (dStart && dEnd && (+dEnd - +dStart) / 86400000 > 31.5)
      return setErr("Khoảng thời gian không vượt quá 1 tháng.");
    setErr(""); setLoading(true);
    try {
      const r = await fetch(api("/api/admin/events/fetch"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serialNumber: serialToFetch.trim().toUpperCase(),
          startDateUtc: toIsoSeconds(dStart),
          endDateUtc: toIsoSeconds(dEnd)
        })
      });
      if (!r.ok) throw new Error(await r.text());
      setLastFetch(await r.json());
      await loadAll();
    } catch (e: any) {
      setErr(e?.message || "Lỗi không xác định");
    } finally {
      setLoading(false);
    }
  };

  // ==== Realtime: nhận ReceiveAlert rồi map sang DbEvent ====
  useEventsRealtime({
    role: "admin",
    onAlert: (payload) => {
      const arr = Array.isArray(payload) ? payload : [payload];
      if (!arr.length) return;

      const mapped = arr.map(alertToDbEvent);
      setRows(prev => {
        const next = [...prev];
        for (const e of mapped) {
          const dup = next.some(
            x => x.serialNumber === e.serialNumber &&
                 x.eventType === e.eventType &&
                 x.eventTimeUtc === e.eventTimeUtc
          );
          if (!dup) next.unshift(e);
        }
        return next;
      });
    }
  });

  return (
    <div className="admin-events">
      <div className="ae-card">
        <h3 className="ae-title">📋 Tất cả sự kiện (Admin)</h3>

        <div className="ae-grid">
          <div className="ae-field">
            <label className="ae-label">Từ</label>
            <input title="ngày bắt đầu" type="datetime-local" value={start} onChange={e=>setStart(e.target.value)} className="ae-input"/>
          </div>
          <div className="ae-field">
            <label className="ae-label">Đến</label>
            <input title="ngày kết thúc" type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)} className="ae-input"/>
          </div>
          <div className="ae-field">
            <label className="ae-label">Lọc theo loại (tùy chọn)</label>
            <input placeholder="alarm / battery / connection ..." value={eventType} onChange={e=>setEventType(e.target.value)} className="ae-input"/>
          </div>
        </div>

        <div className="ae-btnRow">
          <button onClick={loadAll} disabled={loading} className="ae-btn">{loading ? "Đang tải…" : "Tải dữ liệu"}</button>
        </div>

        <div className="ae-grid">
          <div className="ae-field">
            <label className="ae-label">Serial cần kéo</label>
            <input placeholder="Nhập số serial của thiết bị" value={serialToFetch} onChange={e=>setSerialToFetch(e.target.value)} className="ae-input"/>
            <div className="ae-small">Kéo từ LogTag và lưu vào hệ thống</div>
          </div>
          <div className="ae-btnRow">
            <button onClick={fetchOne} disabled={loading} className="ae-btn ae-btn--alt">Kéo LogTag + Lưu</button>
          </div>
        </div>

        {err && <div className="ae-err">{err}</div>}

        {!!lastFetch && (
          <details className="ae-details">
            <summary>Chi tiết lần kéo gần nhất</summary>
            <pre>{JSON.stringify(lastFetch, null, 2)}</pre>
          </details>
        )}

        <div className="ae-total">Tổng: <b>{rows.length}</b> bản ghi</div>

        {/* Timeline */}
        <div className="ae-listWrap">
          {groups.map(([day, list]) => (
            <div key={day} className="ae-dayBlock">
              <div className="ae-dayTitle">{day}</div>
              <div className="ae-line">
                {list.map(e => {
                  const info = humanText(e);
                  const dt = new Date(e.eventTimeUtc);
                  const utc = formatYMDHMS(dt, "UTC");
                  const local = formatYMDHMS(dt);
                  const tz = tzShort(dt);
                  return (
                    <div key={`${e.serialNumber}-${e.eventType}-${e.eventTimeUtc}`} className="ae-node">
                      <div className="ae-dot" />
                      <div
                        className="ae-item ae-item--clickable"
                        onClick={() => setSelected(e)}
                        title="Nhấn để xem chi tiết"
                      >
                        <div className="ae-itemTop">
                          <div className="ae-left">
                            <div className="ae-titleRow">
                              <span className="ae-emoji">{info.icon}</span>
                              <span className="ae-titleText">{info.title}</span>
                            </div>
                            <div className="ae-chipWrap">
                              <span className="ae-tag">{e.serialNumber}</span>
                              <span
                                className={`ae-chip ae-chip--ml ${info.tone==="alarm"?"ae-chip--alarm":info.tone==="battery"?"ae-chip--battery":""}`}
                              >
                                {e.eventType}
                              </span>
                            </div>
                          </div>
                          <div className="ae-right">
                            <div className="ae-time" title={`Giờ địa phương: ${local} ${tz}`}>{utc} UTC</div>
                            <div className="ae-timeHint">{relTime(e.eventTimeUtc)}</div>
                            {info.detail && <div className="ae-detail">{info.detail}</div>}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {!rows.length && <div className="ae-empty">Không có dữ liệu</div>}
        </div>
      </div>

      <EventDetailPanel event={selected} onClose={()=>setSelected(null)} />
    </div>
  );
}
