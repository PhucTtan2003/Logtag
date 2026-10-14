import React, { useEffect, useMemo, useState } from "react";
import api from "../../api/axios";
import Toast from "../../components/Toast";
import "../../styles/User/UserDeviceNames.css";

type DeviceNameRow = {
  userId: string;
  teamId: number;
  serialNumber: string;
  name?: string | null;
  notes?: string | null;
  assignedAtUtc?: string;
};

type ToastState = {
  message: string;
  type: "success" | "error" | "info";
};

function errorText(error: any, fallback: string) {
  const data = error?.response?.data;
  if (typeof data === "string" && data.trim()) return data;
  return data?.message || data?.error || error?.message || fallback;
}

export default function UserDeviceNames() {
  const [rows, setRows] = useState<DeviceNameRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<ToastState | null>(null);

  const keyOf = (row: DeviceNameRow) => `${row.teamId}|${row.serialNumber}`;

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get("/api/device-names/mine");
      const list = Array.isArray(res.data) ? res.data : [];
      setRows(list);
      setDrafts(
        Object.fromEntries(
          list.map((row: DeviceNameRow) => [
            keyOf(row),
            String(row.name ?? row.notes ?? ""),
          ]),
        ),
      );
    } catch (error) {
      setToast({
        type: "error",
        message: errorText(error, "Không tải được danh sách tên thiết bị."),
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return rows;

    return rows.filter((row) => {
      const name = drafts[keyOf(row)] ?? row.name ?? row.notes ?? "";
      return (
        row.serialNumber.toLowerCase().includes(keyword) ||
        String(row.teamId).includes(keyword) ||
        String(name).toLowerCase().includes(keyword)
      );
    });
  }, [drafts, query, rows]);

  const save = async (row: DeviceNameRow) => {
    const key = keyOf(row);
    const name = String(drafts[key] ?? "").trim();

    if (name.length > 80) {
      setToast({ type: "error", message: "Tên thiết bị tối đa 80 ký tự." });
      return;
    }

    setSavingKey(key);
    try {
      await api.put(
        `/api/device-names/mine/${encodeURIComponent(row.serialNumber)}`,
        { teamId: row.teamId, name: name || null },
      );

      setRows((prev) =>
        prev.map((item) =>
          keyOf(item) === key
            ? { ...item, name: name || null, notes: name || null }
            : item,
        ),
      );

      setToast({
        type: "success",
        message: name
          ? `Đã đặt tên “${name}” cho ${row.serialNumber}.`
          : `Đã xóa tên của ${row.serialNumber}.`,
      });
    } catch (error) {
      setToast({
        type: "error",
        message: errorText(error, "Không thể cập nhật tên thiết bị."),
      });
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="udn-root">
      <div className="udn-head">
        <div>
          <span>TÊN GỢI NHỚ THIẾT BỊ</span>
          <h3>Đặt tên tủ/kho cho từng thiết bị</h3>
          <p>
            Tên này sẽ xuất hiện trên cảnh báo realtime và SMS cùng với mã serial,
            giúp bạn biết chính xác tủ nào đang vượt ngưỡng.
          </p>
        </div>

        <button type="button" className="udn-refresh" onClick={() => void load()}>
          Tải lại
        </button>
      </div>

      <label className="udn-search">
        <span>⌕</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Tìm theo serial hoặc tên tủ..."
        />
      </label>

      {loading ? (
        <div className="udn-state">Đang tải thiết bị...</div>
      ) : filtered.length === 0 ? (
        <div className="udn-state">Không có thiết bị phù hợp.</div>
      ) : (
        <div className="udn-list">
          {filtered.map((row) => {
            const key = keyOf(row);
            const draft = drafts[key] ?? "";
            const saving = savingKey === key;

            return (
              <article className="udn-card" key={key}>
                <div className="udn-device">
                  <span>Serial</span>
                  <strong>{row.serialNumber}</strong>
                  <small>Team {row.teamId}</small>
                </div>

                <label className="udn-name-field">
                  <span>Tên tủ / vị trí</span>
                  <input
                    value={draft}
                    maxLength={80}
                    onChange={(event) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [key]: event.target.value,
                      }))
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void save(row);
                      }
                    }}
                    placeholder="Ví dụ: Tủ vaccine A, Kho lạnh số 2..."
                  />
                  <small>{draft.length}/80 ký tự</small>
                </label>

                <button
                  type="button"
                  className="udn-save"
                  disabled={saving}
                  onClick={() => void save(row)}
                >
                  {saving ? "Đang lưu..." : "Lưu tên"}
                </button>
              </article>
            );
          })}
        </div>
      )}

      <div className="udn-example">
        <b>SMS mẫu</b>
        <code>
          [A0A2001951U5-CH1 - Tủ vaccine A] Temperature LOW Alarm: 5.2°C
          (threshold 15°C)
        </code>
      </div>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
          durationMs={toast.type === "success" ? 2200 : 3500}
        />
      )}
    </div>
  );
}