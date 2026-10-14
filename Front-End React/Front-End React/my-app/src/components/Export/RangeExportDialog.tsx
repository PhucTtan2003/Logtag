// src/components/RangeExportDialog.tsx
import React, { useEffect, useRef, useState } from "react";
import { toLocalInputValue, toUtcIsoForQuery } from "../../utils/time";
import "../../styles/Exports/RangeExportDialog.css";

type Props = {
  open: boolean;
  serial: string | null | undefined;
  onClose: () => void;
  onConfirm: (fromIsoUtc: string, toIsoUtc: string) => void;
  maxDays?: number; // default 62 (fallback nếu không đọc được header)
};

const ceilDiffDays = (from: Date, to: Date) => {
  const ms = Math.abs(to.getTime() - from.getTime());
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
};

const RangeExportDialog: React.FC<Props> = ({
  open,
  serial,
  onClose,
  onConfirm,
  maxDays = 62,
}) => {
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);

  const [error, setError] = useState<string>("");
  const [dayCount, setDayCount] = useState<number | null>(null);

  // ---- maxDays lấy từ header (ưu tiên), fallback props
  const [limitDays, setLimitDays] = useState<number>(maxDays);

  // popup vượt giới hạn
  const [showLimitPopup, setShowLimitPopup] = useState(false);
  const [overBy, setOverBy] = useState<number>(0);

  // Khi mở dialog: set default range + đọc header X-Export-MaxDays
  useEffect(() => {
    if (!open) return;

    // 1) Set default: hôm nay 00:00 -> now
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0);
    if (fromRef.current) fromRef.current.value = toLocalInputValue(start);
    if (toRef.current) toRef.current.value = toLocalInputValue(now);
    setError("");
    setDayCount(ceilDiffDays(start, now));
    setShowLimitPopup(false);
    fromRef.current?.focus();

    // 2) Ping BE để đọc header X-Export-MaxDays
    const ac = new AbortController();
    (async () => {
      try {
        // Gọi thiếu param để BE trả 400 nhanh, nhưng vẫn có header
        const res = await fetch("/api/export/export-excel-by-serial", {
          method: "GET",
          credentials: "include",
          signal: ac.signal,
        });
        // Dù 400 vẫn đọc header được
        const h = res.headers.get("x-export-maxdays");
        const parsed = h ? parseInt(h, 10) : NaN;
        if (!Number.isNaN(parsed) && parsed > 0) {
          setLimitDays(parsed);
        } else {
          setLimitDays(maxDays); // fallback từ prop
        }
      } catch {
        setLimitDays(maxDays); // offline / lỗi -> dùng prop
      }
    })();

    return () => ac.abort();
  }, [open, maxDays]);

  // ESC đóng, Enter xác nhận
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showLimitPopup) setShowLimitPopup(false);
        else onClose();
      }
      if (e.key === "Enter" && !showLimitPopup) submit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, showLimitPopup]);

  if (!open) return null;

  const recalc = () => {
    const fromLocal = fromRef.current?.value || "";
    const toLocal = toRef.current?.value || "";
    if (!fromLocal || !toLocal) {
      setDayCount(null);
      return;
    }
    const fromDate = new Date(fromLocal);
    const toDate = new Date(toLocal);
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      setDayCount(null);
      return;
    }
    setDayCount(ceilDiffDays(fromDate, toDate));
  };

  // Quick presets
  const setPreset = (days: number) => {
    const now = new Date();
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    if (fromRef.current) fromRef.current.value = toLocalInputValue(from);
    if (toRef.current) toRef.current.value = toLocalInputValue(now);
    setError("");
    setDayCount(ceilDiffDays(from, now));
  };

  // cắt From về đúng limitDays tính từ To
  const trimToMax = () => {
    const toLocal = toRef.current?.value || "";
    const toDateLocal = new Date(toLocal);
    if (isNaN(toDateLocal.getTime())) {
      setShowLimitPopup(false);
      return;
    }
    const fromTrim = new Date(toDateLocal.getTime() - limitDays * 24 * 60 * 60 * 1000);
    if (fromRef.current) fromRef.current.value = toLocalInputValue(fromTrim);
    setDayCount(limitDays);
    setError("");
    setShowLimitPopup(false);
  };

  const submit = () => {
    setError("");

    const fromLocal = fromRef.current?.value || "";
    const toLocal = toRef.current?.value || "";
    const fromUtc = toUtcIsoForQuery(fromLocal);
    const toUtc = toUtcIsoForQuery(toLocal);

    if (!serial) { setError("Không xác định được thiết bị để xuất."); return; }
    if (!fromUtc || !toUtc) { setError("Thời gian không hợp lệ."); return; }

    const fromDate = new Date(fromUtc);
    const toDate = new Date(toUtc);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) { setError("Thời gian không hợp lệ."); return; }
    if (fromDate >= toDate) { setError("'Từ' phải nhỏ hơn 'Đến'."); return; }

    const d = ceilDiffDays(fromDate, toDate);
    if (d > limitDays) {
      setOverBy(d - limitDays);
      setShowLimitPopup(true);   // bật popup đẹp
      return;
    }

    onConfirm(fromUtc, toUtc);
  };

  return (
    <div className="rx-overlay" role="dialog" aria-modal="true" aria-labelledby="rx-title">
      <div className="rx-panel" tabIndex={-1}>
        {/* Header */}
        <div className="rx-header range-export-header">
          <div className="rx-head-text">
            <div className="rx-title" id="rx-title">📤 Xuất dữ liệu</div>
            <div className="rx-subtitle">
              Thiết bị:&nbsp;<span className="rx-badge" title="Serial">{serial ?? "—"}</span>
            </div>
          </div>
          <button className="close-btn" onClick={onClose} aria-label="Đóng">✕</button>
        </div>

        {/* Lỗi inline */}
        {error && <div className="rx-error" role="alert">{error}</div>}

        <div className="rx-body">
          <div className="range-export-card">
            <div className="range-export-title">Khoảng thời gian</div>
            <div className="range-export-sub" title={`Giới hạn theo hệ thống: tối đa ${limitDays} ngày`}>
              Giới hạn tối đa {limitDays} ngày (~2 tháng).
              {dayCount != null && (
                <span style={{ marginLeft: 8, color: "#0f172a", fontWeight: 700 }}>
                  (Đang chọn: {dayCount} ngày)
                </span>
              )}
            </div>

            {/* Quick presets */}
            <div className="quick-presets" aria-label="Chọn nhanh">
              <button className="btn preset" onClick={() => setPreset(1)}>24h</button>
              <button className="btn preset" onClick={() => setPreset(7)}>7 ngày</button>
              <button className="btn preset" onClick={() => setPreset(30)}>30 ngày</button>
              <button className="btn preset" onClick={() => setPreset(limitDays)}>{limitDays} ngày</button>
            </div>

            <div className="divider" aria-hidden="true" />

            <div className="range-export-grid">
              <div className="range-field">
                <label>Từ</label>
                <div className="dt-wrap">
                  <input ref={fromRef} type="datetime-local" className="rx-input" onChange={recalc} />
                </div>
              </div>

              <div className="range-field">
                <label>Đến</label>
                <div className="dt-wrap">
                  <input ref={toRef} type="datetime-local" className="rx-input" onChange={recalc} />
                </div>
              </div>

              <div className="range-hint">Chọn mốc thời gian phù hợp để tối ưu tốc độ tải file.</div>
            </div>

            <div className="range-actions">
              <button className="btn cancel" onClick={onClose}>Hủy</button>
              <button className="btn ok" onClick={submit}>Xác nhận &amp; Xuất</button>
            </div>
          </div>
        </div>
      </div>

      {/* Mini popup vượt giới hạn */}
      {showLimitPopup && (
        <div className="rx-pop__backdrop" role="dialog" aria-modal="true">
          <div className="rx-pop">
            <div className="rx-pop__icon">⚠️</div>
            <div className="rx-pop__title">Vượt giới hạn {limitDays} ngày</div>
            <div className="rx-pop__msg">
              Khoảng thời gian bạn chọn vượt quá <b>{limitDays}</b> ngày
              {overBy > 0 ? <> (vượt <b>{overBy}</b> ngày)</> : null}.<br />
              Bạn muốn <b>cắt về {limitDays} ngày</b> hay <b>tự chỉnh lại</b>?
            </div>
            <div className="rx-pop__actions">
              <button className="btn ghost" onClick={() => setShowLimitPopup(false)}>Để tôi chỉnh lại</button>
              <button className="btn solid" onClick={trimToMax}>Cắt về {limitDays} ngày</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RangeExportDialog;
