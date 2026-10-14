// src/components/RangeExportDialog.tsx
import React, { useEffect, useRef } from "react";
import { toLocalInputValue, toUtcIsoForQuery } from "../../utils/time";
import "../styles/Exports/RangeExportDialog.css";

type Props = {
  open: boolean;
  serial: string | null | undefined;
  onClose: () => void;
  onConfirm: (fromIsoUtc: string, toIsoUtc: string) => void;
  maxDays?: number; // default 62
};

const RangeExportDialog: React.FC<Props> = ({ open, serial, onClose, onConfirm, maxDays = 62 }) => {
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);

  // default values: today 00:00 -> now
  useEffect(() => {
    if (!open) return;
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0);
    if (fromRef.current) fromRef.current.value = toLocalInputValue(start);
    if (toRef.current) toRef.current.value = toLocalInputValue(now);
    // focus first field
    fromRef.current?.focus();
  }, [open]);

  // close on ESC
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = () => {
    const fromLocal = fromRef.current?.value || "";
    const toLocal = toRef.current?.value || "";
    const fromUtc = toUtcIsoForQuery(fromLocal);
    const toUtc = toUtcIsoForQuery(toLocal);

    if (!serial) return;
    if (!fromUtc || !toUtc) return;
    if (new Date(fromUtc) >= new Date(toUtc)) {
      alert("'Từ' phải nhỏ hơn 'Đến'.");
      return;
    }
    // limit
    const diffDays = Math.abs(new Date(toUtc).getTime() - new Date(fromUtc).getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > maxDays) {
      alert(`Chỉ cho phép tối đa ${maxDays} ngày (~2 tháng).`);
      return;
    }
    onConfirm(fromUtc, toUtc);
  };

  return (
    <div className="rx-overlay" role="dialog" aria-modal="true" aria-labelledby="rx-title">
      <div className="rx-panel" tabIndex={-1}>
        <div className="rx-header range-export-header">
          <div className="rx-head-text">
            <div className="rx-title" id="rx-title">Chọn khoảng thời gian</div>
            <div className="rx-subtitle">Thiết bị: <b>{serial}</b></div>
          </div>
          <button className="close-btn" onClick={onClose} aria-label="Đóng">✕</button>
        </div>

        <div className="rx-body">
          <div className="range-export-card">
            <div className="range-export-title">Khoảng thời gian xuất dữ liệu</div>
            <div className="range-export-sub">Giới hạn tối đa {maxDays} ngày (~2 tháng).</div>

            <div className="range-export-grid">
              <div className="range-field">
                <label>Từ</label>
                <div className="dt-wrap">
                  <input ref={fromRef} type="datetime-local" className="rx-input" />
                </div>
              </div>

              <div className="range-field">
                <label>Đến</label>
                <div className="dt-wrap">
                  <input ref={toRef} type="datetime-local" className="rx-input" />
                </div>
              </div>

              <div className="range-hint">
                Chọn mốc thời gian phù hợp để tối ưu tốc độ tải file.
              </div>
            </div>

            <div className="range-actions">
              <button className="btn cancel" onClick={onClose}>Hủy</button>
              <button className="btn ok" onClick={submit}>Xác nhận & Xuất</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RangeExportDialog;