import React, { useEffect, useMemo, useState } from "react";
import {
  MonthlyReportRun,
  MonthlyReportSchedule,
  SaveMonthlyReportScheduleRequest,
  monthlyReportsApi,
} from "../../services/monthlyReportsApi";
import "./monthlyReports.css";

type FlashType = "success" | "error" | "info";

type Flash = {
  type: FlashType;
  message: string;
};

const DEFAULT_FORM: SaveMonthlyReportScheduleRequest = {
  teamId: 16922,
  serialNumbers: [],
  recipients: [],
  cc: [],
  sendDayOfMonth: 1,
  sendTimeLocal: "08:00",
  timeZoneId: "Asia/Ho_Chi_Minh",
  format: "csv",
  isEnabled: true,
  includeSummary: true,
  includeRawData: true,
  includeAlerts: true,
};

function splitList(value: string): string[] {
  return value
    .split(/[\n,;]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function joinList(value: string[] | undefined): string {
  return (value ?? []).join("\n");
}

function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function statusText(status: string): string {
  const s = (status || "").toLowerCase();
  if (s === "success") return "Đã gửi";
  if (s === "failed") return "Lỗi";
  if (s === "pending") return "Đang xử lý";
  return status || "—";
}

function getCurrentMonthLabel(): string {
  const now = new Date();
  const reportMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return reportMonth.toLocaleDateString("vi-VN", { month: "2-digit", year: "numeric" });
}

export default function MonthlyReportsPage() {
  const [schedules, setSchedules] = useState<MonthlyReportSchedule[]>([]);
  const [runs, setRuns] = useState<MonthlyReportRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);

  const [form, setForm] = useState<SaveMonthlyReportScheduleRequest>(DEFAULT_FORM);
  const [serialText, setSerialText] = useState("");
  const [recipientText, setRecipientText] = useState("");
  const [ccText, setCcText] = useState("");

  const activeSchedules = useMemo(
    () => schedules.filter((x) => x.isEnabled).length,
    [schedules]
  );

  async function loadAll() {
    setLoading(true);
    try {
      const [scheduleData, runData] = await Promise.all([
        monthlyReportsApi.listMySchedules(),
        monthlyReportsApi.listMyRuns(),
      ]);
      setSchedules(scheduleData);
      setRuns(runData);
    } catch (err: any) {
      setFlash({
        type: "error",
        message: err?.response?.data?.message || err?.message || "Không tải được dữ liệu báo cáo.",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  function resetForm() {
    setEditingId(null);
    setForm(DEFAULT_FORM);
    setSerialText("");
    setRecipientText("");
    setCcText("");
  }

  function editSchedule(item: MonthlyReportSchedule) {
    setEditingId(item.id);
    setForm({
      teamId: item.teamId,
      serialNumbers: item.serialNumbers ?? [],
      recipients: item.recipients ?? [],
      cc: item.cc ?? [],
      sendDayOfMonth: item.sendDayOfMonth || 1,
      sendTimeLocal: item.sendTimeLocal || "08:00",
      timeZoneId: item.timeZoneId || "Asia/Ho_Chi_Minh",
      format: item.format || "csv",
      isEnabled: item.isEnabled,
      includeSummary: item.includeSummary !== false,
      includeRawData: item.includeRawData !== false,
      includeAlerts: item.includeAlerts !== false,
    });
    setSerialText(joinList(item.serialNumbers));
    setRecipientText(joinList(item.recipients));
    setCcText(joinList(item.cc));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function buildPayload(): SaveMonthlyReportScheduleRequest {
    return {
      ...form,
      teamId: Number(form.teamId),
      serialNumbers: splitList(serialText).map((x) => x.toUpperCase()),
      recipients: splitList(recipientText),
      cc: splitList(ccText),
      sendDayOfMonth: Number(form.sendDayOfMonth),
      sendTimeLocal: form.sendTimeLocal || "08:00",
      timeZoneId: form.timeZoneId || "Asia/Ho_Chi_Minh",
      format: "csv",
    };
  }

  async function saveSchedule(e: React.FormEvent) {
    e.preventDefault();
    setFlash(null);

    const payload = buildPayload();
    if (!payload.teamId || payload.teamId <= 0) {
      setFlash({ type: "error", message: "TeamId không hợp lệ." });
      return;
    }
    if (payload.serialNumbers.length === 0) {
      setFlash({ type: "error", message: "Vui lòng nhập ít nhất 1 serial thiết bị." });
      return;
    }
    if (payload.recipients.length === 0) {
      setFlash({ type: "error", message: "Vui lòng nhập ít nhất 1 email nhận báo cáo." });
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        await monthlyReportsApi.updateSchedule(editingId, payload);
        setFlash({ type: "success", message: "Đã cập nhật lịch gửi báo cáo." });
      } else {
        await monthlyReportsApi.createSchedule(payload);
        setFlash({ type: "success", message: "Đã tạo lịch gửi báo cáo hàng tháng." });
      }
      resetForm();
      await loadAll();
    } catch (err: any) {
      setFlash({
        type: "error",
        message: err?.response?.data?.message || err?.message || "Lưu lịch gửi thất bại.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function deleteSchedule(id: string) {
    const ok = window.confirm("Bạn muốn xoá lịch gửi báo cáo này?");
    if (!ok) return;
    setBusyId(id);
    try {
      await monthlyReportsApi.deleteSchedule(id);
      setFlash({ type: "success", message: "Đã xoá lịch gửi báo cáo." });
      await loadAll();
      if (editingId === id) resetForm();
    } catch (err: any) {
      setFlash({
        type: "error",
        message: err?.response?.data?.message || err?.message || "Xoá thất bại.",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function sendTest(id: string) {
    setBusyId(id);
    try {
      await monthlyReportsApi.sendTest(id);
      setFlash({ type: "success", message: "Đã gửi thử báo cáo. Vui lòng kiểm tra email." });
      await loadAll();
    } catch (err: any) {
      setFlash({
        type: "error",
        message: err?.response?.data?.message || err?.message || "Gửi thử thất bại.",
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mrp-page">
      <div className="mrp-hero">
        <div>
          <p className="mrp-eyebrow">LogTag Monthly Auto Report</p>
          <h1>Báo cáo tự động hàng tháng</h1>
          <p>
            Hệ thống tự động tổng hợp dữ liệu nhiệt độ tháng trước và gửi email cho khách theo lịch đã cài.
          </p>
        </div>
        <div className="mrp-hero-card">
          <span>Tháng báo cáo gần nhất</span>
          <strong>{getCurrentMonthLabel()}</strong>
          <small>{activeSchedules}/{schedules.length} lịch đang bật</small>
        </div>
      </div>

      {flash && <div className={`mrp-alert mrp-alert-${flash.type}`}>{flash.message}</div>}

      <div className="mrp-grid">
        <section className="mrp-card mrp-form-card">
          <div className="mrp-section-head">
            <div>
              <h2>{editingId ? "Cập nhật lịch gửi" : "Tạo lịch gửi mới"}</h2>
              <p>Nhập serial, email nhận và thời điểm gửi báo cáo.</p>
            </div>
            {editingId && (
              <button type="button" className="mrp-btn mrp-btn-ghost" onClick={resetForm}>
                Huỷ sửa
              </button>
            )}
          </div>

          <form onSubmit={saveSchedule} className="mrp-form">
            <div className="mrp-field-row">
              <label className="mrp-field">
                <span>TeamId</span>
                <input
                  type="number"
                  value={form.teamId}
                  onChange={(e) => setForm((p) => ({ ...p, teamId: Number(e.target.value) }))}
                  min={1}
                />
              </label>
              <label className="mrp-field">
                <span>Ngày gửi hàng tháng</span>
                <select
                  value={form.sendDayOfMonth}
                  onChange={(e) => setForm((p) => ({ ...p, sendDayOfMonth: Number(e.target.value) }))}
                >
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                    <option key={day} value={day}>
                      Ngày {day}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mrp-field">
                <span>Giờ gửi</span>
                <input
                  type="time"
                  value={form.sendTimeLocal}
                  onChange={(e) => setForm((p) => ({ ...p, sendTimeLocal: e.target.value }))}
                />
              </label>
            </div>

            <label className="mrp-field">
              <span>Serial thiết bị</span>
              <textarea
                value={serialText}
                onChange={(e) => setSerialText(e.target.value)}
                placeholder="A0A5003073MH&#10;A0A10054172O"
                rows={4}
              />
              <small>Có thể nhập nhiều serial, mỗi dòng một serial hoặc cách nhau bằng dấu phẩy.</small>
            </label>

            <label className="mrp-field">
              <span>Email nhận báo cáo</span>
              <textarea
                value={recipientText}
                onChange={(e) => setRecipientText(e.target.value)}
                placeholder="customer@example.com&#10;manager@example.com"
                rows={3}
              />
            </label>

            <label className="mrp-field">
              <span>CC nếu có</span>
              <input
                value={ccText}
                onChange={(e) => setCcText(e.target.value)}
                placeholder="admin@example.com, support@example.com"
              />
            </label>

            <div className="mrp-field-row">
              <label className="mrp-field">
                <span>Múi giờ</span>
                <select
                  value={form.timeZoneId}
                  onChange={(e) => setForm((p) => ({ ...p, timeZoneId: e.target.value }))}
                >
                  <option value="Asia/Ho_Chi_Minh">Việt Nam - Asia/Ho_Chi_Minh</option>
                  <option value="UTC">UTC</option>
                </select>
              </label>
              <label className="mrp-field">
                <span>Định dạng</span>
                <select value="csv" disabled>
                  <option value="csv">CSV - bản MVP</option>
                </select>
              </label>
            </div>

            <div className="mrp-checks">
              <label>
                <input
                  type="checkbox"
                  checked={form.isEnabled}
                  onChange={(e) => setForm((p) => ({ ...p, isEnabled: e.target.checked }))}
                />
                Bật lịch gửi
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={form.includeSummary}
                  onChange={(e) => setForm((p) => ({ ...p, includeSummary: e.target.checked }))}
                />
                Gồm tổng quan
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={form.includeRawData}
                  onChange={(e) => setForm((p) => ({ ...p, includeRawData: e.target.checked }))}
                />
                Gồm dữ liệu thô
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={form.includeAlerts}
                  onChange={(e) => setForm((p) => ({ ...p, includeAlerts: e.target.checked }))}
                />
                Gồm cảnh báo
              </label>
            </div>

            <div className="mrp-actions">
              <button className="mrp-btn mrp-btn-primary" disabled={saving}>
                {saving ? "Đang lưu..." : editingId ? "Lưu thay đổi" : "Tạo lịch gửi"}
              </button>
              <button type="button" className="mrp-btn mrp-btn-soft" onClick={loadAll} disabled={loading}>
                Làm mới
              </button>
            </div>
          </form>
        </section>

        <aside className="mrp-card mrp-tip-card">
          <h2>Gợi ý vận hành</h2>
          <div className="mrp-tip-list">
            <div>
              <b>Nên gửi ngày 1</b>
              <span>Để dữ liệu cuối tháng trước đồng bộ đủ rồi mới gửi.</span>
            </div>
            <div>
              <b>Test trước khi bật</b>
              <span>Dùng nút “Gửi thử” để kiểm tra SMTP và nội dung email.</span>
            </div>
            <div>
              <b>CSV trước, Excel sau</b>
              <span>Bản này ưu tiên chạy ổn định, sau đó nâng cấp file Excel/PDF.</span>
            </div>
          </div>
        </aside>
      </div>

      <section className="mrp-card mrp-list-card">
        <div className="mrp-section-head">
          <div>
            <h2>Lịch gửi của tôi</h2>
            <p>{loading ? "Đang tải..." : `${schedules.length} lịch gửi báo cáo`}</p>
          </div>
        </div>

        {schedules.length === 0 ? (
          <div className="mrp-empty">Chưa có lịch gửi nào. Tạo lịch đầu tiên ở form phía trên.</div>
        ) : (
          <div className="mrp-schedule-grid">
            {schedules.map((item) => (
              <article key={item.id} className="mrp-schedule-card">
                <div className="mrp-schedule-top">
                  <span className={`mrp-status ${item.isEnabled ? "on" : "off"}`}>
                    {item.isEnabled ? "Đang bật" : "Đang tắt"}
                  </span>
                  <span className="mrp-format">{item.format || "csv"}</span>
                </div>
                <h3>{item.serialNumbers?.length || 0} thiết bị</h3>
                <p className="mrp-muted">
                  Gửi ngày {item.sendDayOfMonth} hàng tháng lúc {item.sendTimeLocal || "08:00"}
                </p>
                <div className="mrp-chip-list">
                  {(item.serialNumbers ?? []).slice(0, 4).map((sn) => (
                    <span key={sn}>{sn}</span>
                  ))}
                  {(item.serialNumbers?.length ?? 0) > 4 && <span>+{item.serialNumbers.length - 4}</span>}
                </div>
                <div className="mrp-mini-block">
                  <small>Người nhận</small>
                  <b>{(item.recipients ?? []).join(", ") || "—"}</b>
                </div>
                <div className="mrp-card-actions">
                  <button className="mrp-btn mrp-btn-soft" onClick={() => editSchedule(item)}>
                    Sửa
                  </button>
                  <button
                    className="mrp-btn mrp-btn-soft"
                    disabled={busyId === item.id}
                    onClick={() => sendTest(item.id)}
                  >
                    Gửi thử
                  </button>
                  <button
                    className="mrp-btn mrp-btn-danger"
                    disabled={busyId === item.id}
                    onClick={() => deleteSchedule(item.id)}
                  >
                    Xoá
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="mrp-card mrp-table-card">
        <div className="mrp-section-head">
          <div>
            <h2>Lịch sử gửi gần đây</h2>
            <p>Theo dõi trạng thái gửi mail và lỗi nếu có.</p>
          </div>
        </div>
        <div className="mrp-table-wrap">
          <table className="mrp-table">
            <thead>
              <tr>
                <th>Tháng</th>
                <th>Trạng thái</th>
                <th>Người nhận</th>
                <th>Bắt đầu</th>
                <th>Đã gửi</th>
                <th>File</th>
                <th>Lỗi</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="mrp-empty-cell">
                    Chưa có lịch sử gửi.
                  </td>
                </tr>
              ) : (
                runs.map((run) => (
                  <tr key={run.id}>
                    <td>{run.periodKey}</td>
                    <td>
                      <span className={`mrp-run-badge ${(run.status || "").toLowerCase()}`}>
                        {statusText(run.status)}
                      </span>
                    </td>
                    <td>{(run.recipients ?? []).join(", ") || "—"}</td>
                    <td>{formatDateTime(run.startedAtUtc)}</td>
                    <td>{formatDateTime(run.sentAtUtc)}</td>
                    <td>{(run.attachmentNames ?? []).join(", ") || "—"}</td>
                    <td className="mrp-error-text">{run.error || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
