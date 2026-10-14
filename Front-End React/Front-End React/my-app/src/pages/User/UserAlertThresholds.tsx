// src/pages/User/UserAlertThresholds.tsx
import React, { useEffect, useMemo, useState } from "react";
import api from "../../api/axios";
import "../../styles/User/UserAlertThresholds.css";

type ThresholdItem = {
  serialNumber: string;
  model?: string | null;
  teamId?: string | number | null;
  upperThreshold?: number | null;
  lowerThreshold?: number | null;
  updatedAtUtc?: string | null;
  updatedBy?: string | null;
  canEdit?: boolean;
  device?: {
    serialNumber?: string | null;
    model?: string | null;
    teamId?: string | number | null;
  } | null;
};

type DraftValue = {
  upper: string;
  lower: string;
};

type ToastState = {
  message: string;
  type: "success" | "error" | "info";
};

const normalizeSerial = (value?: string | null) =>
  String(value ?? "").trim().toUpperCase();

const toDraft = (item: ThresholdItem): DraftValue => ({
  upper:
    item.upperThreshold === null || item.upperThreshold === undefined
      ? ""
      : String(item.upperThreshold),
  lower:
    item.lowerThreshold === null || item.lowerThreshold === undefined
      ? ""
      : String(item.lowerThreshold),
});

const parseNullableNumber = (value: string): number | null => {
  const raw = value.trim();
  if (!raw) return null;

  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n)) return NaN;

  return n;
};

const formatDate = (value?: string | null) => {
  if (!value) return "Chưa cập nhật";

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;

  return d.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const hasAnyThreshold = (item: ThresholdItem) =>
  item.upperThreshold !== null &&
    item.upperThreshold !== undefined ||
  item.lowerThreshold !== null &&
    item.lowerThreshold !== undefined;

export default function UserAlertThresholds() {
  const [items, setItems] = useState<ThresholdItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftValue>>({});
  const [loading, setLoading] = useState(false);
  const [savingSerial, setSavingSerial] = useState<string | null>(null);
  const [deletingSerial, setDeletingSerial] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [toast, setToast] = useState<ToastState | null>(null);

  const loadData = async () => {
    setLoading(true);

    try {
      const res = await api.get("/api/alert-thresholds");

      const rawList: ThresholdItem[] = Array.isArray(res.data)
        ? res.data
        : Array.isArray(res.data?.items)
          ? res.data.items
          : Array.isArray(res.data?.data)
            ? res.data.data
            : [];

      const normalized = rawList
        .map((x) => {
          const serial = normalizeSerial(
            x.serialNumber || x.device?.serialNumber
          );

          return {
            ...x,
            serialNumber: serial,
            model: x.model ?? x.device?.model ?? null,
            teamId: x.teamId ?? x.device?.teamId ?? null,
          };
        })
        .filter((x) => x.serialNumber);

      setItems(normalized);

      const nextDrafts: Record<string, DraftValue> = {};
      normalized.forEach((item) => {
        nextDrafts[item.serialNumber] = toDraft(item);
      });

      setDrafts(nextDrafts);
    } catch (e: any) {
      console.error(e);
      setItems([]);
      setDrafts({});
      setToast({
        message:
          e?.response?.data?.message ??
          "❌ Không tải được danh sách ngưỡng.",
        type: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Toast riêng cho màn Cài ngưỡng. Không dùng Toast component global
  // để tránh bị dính layout thông báo ngang của UserPage.
  useEffect(() => {
    if (!toast) return;

    const ms = toast.type === "success" ? 2200 : 3200;
    const timer = window.setTimeout(() => setToast(null), ms);

    return () => window.clearTimeout(timer);
  }, [toast]);

  const stats = useMemo(() => {
    const total = items.length;
    const configured = items.filter(hasAnyThreshold).length;
    const empty = Math.max(0, total - configured);

    return { total, configured, empty };
  }, [items]);

  const filtered = useMemo(() => {
    const key = q.trim().toLowerCase();
    if (!key) return items;

    return items.filter((item) => {
      return (
        item.serialNumber.toLowerCase().includes(key) ||
        String(item.model ?? "").toLowerCase().includes(key) ||
        String(item.teamId ?? "").toLowerCase().includes(key)
      );
    });
  }, [items, q]);

  const updateDraft = (
    serial: string,
    field: keyof DraftValue,
    value: string
  ) => {
    setDrafts((prev) => ({
      ...prev,
      [serial]: {
        ...(prev[serial] ?? { upper: "", lower: "" }),
        [field]: value,
      },
    }));
  };

  const handleSave = async (serial: string) => {
    const draft = drafts[serial] ?? { upper: "", lower: "" };

    const upper = parseNullableNumber(draft.upper);
    const lower = parseNullableNumber(draft.lower);

    if (Number.isNaN(upper) || Number.isNaN(lower)) {
      setToast({
        message: "❌ Ngưỡng phải là số hợp lệ.",
        type: "error",
      });
      return;
    }

    if (upper === null && lower === null) {
      setToast({
        message: "❌ Vui lòng nhập ít nhất 1 ngưỡng.",
        type: "error",
      });
      return;
    }

    if (upper !== null && lower !== null && upper <= lower) {
      setToast({
        message: "❌ Ngưỡng trên phải lớn hơn ngưỡng dưới.",
        type: "error",
      });
      return;
    }

    setSavingSerial(serial);

    try {
      const res = await api.put(
        `/api/alert-thresholds/${encodeURIComponent(serial)}`,
        {
          upperThreshold: upper,
          lowerThreshold: lower,
        }
      );

      const saved = res.data?.item;

      setItems((prev) =>
        prev.map((item) =>
          item.serialNumber === serial
            ? {
                ...item,
                upperThreshold: saved?.upperThreshold ?? upper,
                lowerThreshold: saved?.lowerThreshold ?? lower,
                updatedAtUtc:
                  saved?.updatedAtUtc ?? new Date().toISOString(),
                updatedBy: saved?.updatedBy ?? item.updatedBy,
              }
            : item
        )
      );

      setToast({
        message: `✅ Đã lưu ngưỡng cho ${serial}.`,
        type: "success",
      });
    } catch (e: any) {
      console.error(e);
      setToast({
        message:
          e?.response?.data?.message ?? "❌ Không thể lưu ngưỡng.",
        type: "error",
      });
    } finally {
      setSavingSerial(null);
    }
  };

  const handleDelete = async (serial: string) => {
    const ok = window.confirm(`Xóa ngưỡng cảnh báo của thiết bị ${serial}?`);
    if (!ok) return;

    setDeletingSerial(serial);

    try {
      await api.delete(`/api/alert-thresholds/${encodeURIComponent(serial)}`);

      setItems((prev) =>
        prev.map((item) =>
          item.serialNumber === serial
            ? {
                ...item,
                upperThreshold: null,
                lowerThreshold: null,
                updatedAtUtc: null,
              }
            : item
        )
      );

      setDrafts((prev) => ({
        ...prev,
        [serial]: { upper: "", lower: "" },
      }));

      setToast({
        message: `✅ Đã xóa ngưỡng của ${serial}.`,
        type: "success",
      });
    } catch (e: any) {
      console.error(e);
      setToast({
        message:
          e?.response?.data?.message ?? "❌ Không thể xóa ngưỡng.",
        type: "error",
      });
    } finally {
      setDeletingSerial(null);
    }
  };

  return (
    <div className="uth-page uth-page--compact">
      <section className="uth-head">
        <div>
          <p className="uth-eyebrow">Temperature threshold</p>
          <h1>Cài ngưỡng cảnh báo</h1>
          <p>
            Chỉ hiển thị các thiết bị đã được Admin gán cho tài khoản của bạn.
          </p>
        </div>

        <button className="uth-refresh" onClick={loadData} disabled={loading}>
          {loading ? "Đang tải..." : "Làm mới"}
        </button>
      </section>

      <section className="uth-summary">
        <div className="uth-summary-card">
          <span>Tổng thiết bị</span>
          <b>{stats.total}</b>
        </div>

        <div className="uth-summary-card is-ok">
          <span>Đã cài</span>
          <b>{stats.configured}</b>
        </div>

        <div className="uth-summary-card is-warn">
          <span>Chưa cài</span>
          <b>{stats.empty}</b>
        </div>

        <div className="uth-search">
          <label>Tìm thiết bị</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nhập serial, model hoặc team..."
          />
        </div>
      </section>

      {loading && <div className="uth-state">Đang tải danh sách thiết bị...</div>}

      {!loading && items.length === 0 && (
        <div className="uth-empty">
          <div className="uth-empty-icon">🛰️</div>
          <h3>Chưa có thiết bị nào được gán</h3>
          <p>
            Vui lòng liên hệ Admin để được gán thiết bị trước khi cài ngưỡng
            cảnh báo.
          </p>
        </div>
      )}

      {!loading && items.length > 0 && filtered.length === 0 && (
        <div className="uth-empty">
          <div className="uth-empty-icon">🔎</div>
          <h3>Không tìm thấy thiết bị</h3>
          <p>Thử nhập serial hoặc model khác.</p>
        </div>
      )}

      <section className="uth-device-list">
        {filtered.map((item) => {
          const serial = item.serialNumber;
          const draft = drafts[serial] ?? { upper: "", lower: "" };
          const configured = hasAnyThreshold(item);
          const isBusy = savingSerial === serial || deletingSerial === serial;

          return (
            <article className="uth-device-card" key={serial}>
              <div className="uth-device-main">
                <div className="uth-device-title">
                  <div>
                    <span className="uth-label">Serial</span>
                    <h2>{serial}</h2>
                  </div>

                  <span
                    className={
                      configured ? "uth-status is-active" : "uth-status"
                    }
                  >
                    {configured ? "Đã cài" : "Chưa cài"}
                  </span>
                </div>

                <div className="uth-device-meta">
                  <div>
                    <span>Model</span>
                    <b>{item.model || "Không rõ"}</b>
                  </div>

                  <div>
                    <span>Team</span>
                    <b>{item.teamId ?? "N/A"}</b>
                  </div>

                  <div>
                    <span>Ngưỡng hiện tại</span>
                    <b>
                      {item.lowerThreshold ?? "--"}°C →{" "}
                      {item.upperThreshold ?? "--"}°C
                    </b>
                  </div>

                  <div>
                    <span>Cập nhật</span>
                    <b>{formatDate(item.updatedAtUtc)}</b>
                  </div>
                </div>
              </div>

              <div className="uth-threshold-panel">
                <div className="uth-field uth-field--high">
                  <label>Ngưỡng trên</label>
                  <div className="uth-input">
                    <input
                      type="number"
                      step="0.1"
                      value={draft.upper}
                      onChange={(e) =>
                        updateDraft(serial, "upper", e.target.value)
                      }
                      placeholder="VD: 8"
                    />
                    <span>°C</span>
                  </div>
                  <small>Cảnh báo khi nhiệt độ lớn hơn mức này.</small>
                </div>

                <div className="uth-field uth-field--low">
                  <label>Ngưỡng dưới</label>
                  <div className="uth-input">
                    <input
                      type="number"
                      step="0.1"
                      value={draft.lower}
                      onChange={(e) =>
                        updateDraft(serial, "lower", e.target.value)
                      }
                      placeholder="VD: 2"
                    />
                    <span>°C</span>
                  </div>
                  <small>Cảnh báo khi nhiệt độ nhỏ hơn mức này.</small>
                </div>

                <div className="uth-actions">
                  <button
                    className="uth-btn uth-btn--primary"
                    onClick={() => handleSave(serial)}
                    disabled={isBusy}
                  >
                    {savingSerial === serial ? "Đang lưu..." : "Lưu ngưỡng"}
                  </button>

                  <button
                    className="uth-btn uth-btn--ghost"
                    onClick={() => handleDelete(serial)}
                    disabled={isBusy || !configured}
                  >
                    {deletingSerial === serial ? "Đang xóa..." : "Xóa"}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </section>

      {toast && (
        <div className="uth-toast-stack" role="status" aria-live="polite">
          <div className={`uth-toast uth-toast--${toast.type}`}>
            <span className="uth-toast__icon" aria-hidden="true">
              {toast.type === "success" ? "✅" : toast.type === "error" ? "⚠️" : "ℹ️"}
            </span>

            <div className="uth-toast__body">
              <b>
                {toast.type === "success"
                  ? "Thành công"
                  : toast.type === "error"
                    ? "Cần kiểm tra"
                    : "Thông báo"}
              </b>
              <span>{toast.message.replace(/^[✅❌⚠️ℹ️]\s*/, "")}</span>
            </div>

            <button
              type="button"
              className="uth-toast__close"
              onClick={() => setToast(null)}
              aria-label="Đóng thông báo"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}