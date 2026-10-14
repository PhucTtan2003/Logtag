import React, { useEffect, useMemo, useState } from "react";
import {
  MonthlyReportRun,
  MonthlyReportSchedule,
  monthlyReportsApi,
} from "../../services/monthlyReportsApi";
import "../reports/monthlyReports.css";

type FlashType = "success" | "error" | "info";

type Flash = {
  type: FlashType;
  message: string;
};

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

export default function AdminMonthlyReportsPage() {
  const [schedules, setSchedules] = useState<MonthlyReportSchedule[]>([]);
  const [runs, setRuns] = useState<MonthlyReportRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [flash, setFlash] = useState<Flash | null>(null);

  async function loadAll() {
    setLoading(true);
    try {
      const [scheduleData, runData] = await Promise.all([
        monthlyReportsApi.adminListSchedules(),
        monthlyReportsApi.adminListRuns(),
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

  const filteredSchedules = useMemo(() => {
    const key = search.trim().toLowerCase();
    if (!key) return schedules;
    return schedules.filter((item) => {
      const text = [
        item.userEmail,
        item.userName,
        item.teamId,
        ...(item.serialNumbers ?? []),
        ...(item.recipients ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return text.includes(key);
    });
  }, [schedules, search]);

  const stats = useMemo(() => {
    const total = schedules.length;
    const active = schedules.filter((x) => x.isEnabled).length;
    const failed = runs.filter((x) => (x.status || "").toLowerCase() === "failed").length;
    const success = runs.filter((x) => (x.status || "").toLowerCase() === "success").length;
    return { total, active, failed, success };
  }, [schedules, runs]);

  async function toggleSchedule(item: MonthlyReportSchedule) {
    setBusyId(item.id);
    try {
      await monthlyReportsApi.adminToggleSchedule(item.id, !item.isEnabled);
      setFlash({
        type: "success",
        message: !item.isEnabled ? "Đã bật lịch gửi." : "Đã tắt lịch gửi.",
      });
      await loadAll();
    } catch (err: any) {
      setFlash({
        type: "error",
        message: err?.response?.data?.message || err?.message || "Không cập nhật được trạng thái.",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function sendNow(item: MonthlyReportSchedule) {
    const ok = window.confirm("Gửi ngay báo cáo tháng trước cho lịch này?");
    if (!ok) return;
    setBusyId(item.id);
    try {
      await monthlyReportsApi.adminSendNow(item.id);
      setFlash({ type: "success", message: "Đã gửi báo cáo ngay. Vui lòng kiểm tra lịch sử gửi." });
      await loadAll();
    } catch (err: any) {
      setFlash({
        type: "error",
        message: err?.response?.data?.message || err?.message || "Gửi ngay thất bại.",
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mrp-page">
      <div className="mrp-hero mrp-admin-hero">
        <div>
          <p className="mrp-eyebrow">Admin Control Center</p>
          <h1>Quản lý báo cáo tự động</h1>
          <p>Kiểm soát toàn bộ lịch gửi báo cáo hàng tháng, gửi thủ công và theo dõi lỗi SMTP.</p>
        </div>
        <div className="mrp-admin-stats">
          <div>
            <span>Tổng lịch</span>
            <b>{stats.total}</b>
          </div>
          <div>
            <span>Đang bật</span>
            <b>{stats.active}</b>
          </div>
          <div>
            <span>Gửi thành công</span>
            <b>{stats.success}</b>
          </div>
          <div>
            <span>Lỗi</span>
            <b>{stats.failed}</b>
          </div>
        </div>
      </div>

      {flash && <div className={`mrp-alert mrp-alert-${flash.type}`}>{flash.message}</div>}

      <section className="mrp-card mrp-table-card">
        <div className="mrp-section-head mrp-admin-tools">
          <div>
            <h2>Danh sách lịch gửi</h2>
            <p>{loading ? "Đang tải..." : `${filteredSchedules.length}/${schedules.length} lịch`}</p>
          </div>
          <div className="mrp-tool-actions">
            <input
              className="mrp-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm theo email, serial, teamId..."
            />
            <button className="mrp-btn mrp-btn-soft" onClick={loadAll} disabled={loading}>
              Làm mới
            </button>
          </div>
        </div>

        <div className="mrp-table-wrap">
          <table className="mrp-table">
            <thead>
              <tr>
                <th>Khách hàng</th>
                <th>Team</th>
                <th>Thiết bị</th>
                <th>Người nhận</th>
                <th>Lịch gửi</th>
                <th>Trạng thái</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filteredSchedules.length === 0 ? (
                <tr>
                  <td colSpan={7} className="mrp-empty-cell">
                    Không có lịch gửi phù hợp.
                  </td>
                </tr>
              ) : (
                filteredSchedules.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <b>{item.userName || item.userEmail || item.userId || "—"}</b>
                      {item.userEmail && <small className="mrp-subline">{item.userEmail}</small>}
                    </td>
                    <td>{item.teamId}</td>
                    <td>
                      <div className="mrp-chip-list compact">
                        {(item.serialNumbers ?? []).slice(0, 3).map((sn) => (
                          <span key={sn}>{sn}</span>
                        ))}
                        {(item.serialNumbers?.length ?? 0) > 3 && <span>+{item.serialNumbers.length - 3}</span>}
                      </div>
                    </td>
                    <td>{(item.recipients ?? []).join(", ") || "—"}</td>
                    <td>
                      Ngày {item.sendDayOfMonth} lúc {item.sendTimeLocal || "08:00"}
                      <small className="mrp-subline">{item.timeZoneId || "Asia/Ho_Chi_Minh"}</small>
                    </td>
                    <td>
                      <span className={`mrp-status ${item.isEnabled ? "on" : "off"}`}>
                        {item.isEnabled ? "Đang bật" : "Đang tắt"}
                      </span>
                    </td>
                    <td>
                      <div className="mrp-inline-actions">
                        <button
                          className="mrp-btn mrp-btn-soft"
                          disabled={busyId === item.id}
                          onClick={() => toggleSchedule(item)}
                        >
                          {item.isEnabled ? "Tắt" : "Bật"}
                        </button>
                        <button
                          className="mrp-btn mrp-btn-primary"
                          disabled={busyId === item.id}
                          onClick={() => sendNow(item)}
                        >
                          Gửi ngay
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mrp-card mrp-table-card">
        <div className="mrp-section-head">
          <div>
            <h2>Lịch sử gửi toàn hệ thống</h2>
            <p>Theo dõi mail đã gửi, file đính kèm và lỗi phát sinh.</p>
          </div>
        </div>
        <div className="mrp-table-wrap">
          <table className="mrp-table">
            <thead>
              <tr>
                <th>Khách hàng</th>
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
                  <td colSpan={8} className="mrp-empty-cell">
                    Chưa có lịch sử gửi.
                  </td>
                </tr>
              ) : (
                runs.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <b>{run.userName || run.userEmail || run.userId || "—"}</b>
                      {run.userEmail && <small className="mrp-subline">{run.userEmail}</small>}
                    </td>
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
