import React, { useEffect, useMemo, useState } from "react";
import api from "../../api/axios";
import "../../styles/Admin/AdminSmsScheduleMonitor.css";

type SmsConfig = {
  id?: string;
  userId?: string;
  email?: string | null;
  username?: string | null;
  serialNumber?: string;
  scheduleTimes?: string[];
  enabled?: boolean;
  lastChangedLocalDate?: string | null;
  lastChangedAtUtc?: string | null;
  updatedAtUtc?: string | null;
};

type SmsJob = {
  id?: string;
  jobKey?: string;
  userId?: string;
  serialNumber?: string;
  phone?: string;
  scheduleTime?: string;
  runAtUtc?: string;
  status?: string;
  retryCount?: number;
  lastError?: string | null;
  createdAtUtc?: string;
  sentAtUtc?: string | null;
};

type SmsHistory = {
  id?: string;
  jobId?: string;
  userId?: string;
  serialNumber?: string;
  phone?: string;
  scheduleTime?: string;
  temperature?: number | null;
  humidity?: number | null;
  readingAtUtc?: string | null;
  provider?: string | null;
  success?: boolean;
  error?: string | null;
  createdAtUtc?: string;
  sentAtUtc?: string | null;
};

const fmt = (iso?: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";

  return d.toLocaleString("vi-VN", {
    hour12: false,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};


const maskPhone = (p?: string | null) => {
  if (!p) return "—";
  if (p.length <= 6) return p;
  return `${p.slice(0, 4)}••••${p.slice(-3)}`;
};


const statusText: Record<string, string> = {
  pending: "Chờ gửi",
  processing: "Đang xử lý",
  sent: "Đã gửi",
  failed: "Lỗi",
};
type ApiList<T> = {
  total?: number;
  items?: T[];
};

type ApiAction = {
  ok?: boolean;
  message?: string;
};

function getApiErrorMessage(err: any, fallback: string) {
  const data = err?.response?.data;

  if (typeof data === "string") {
    const preview = data.trim().slice(0, 160);
    if (preview.toLowerCase().startsWith("<!doctype") || preview.toLowerCase().startsWith("<html")) {
      return "API đang trỏ sai hoặc backend chưa chạy. Server trả về HTML thay vì JSON.";
    }
    return preview || fallback;
  }

  return (
    data?.message ||
    data?.error ||
    data?.detail ||
    err?.message ||
    fallback
  );
}

async function apiFetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  try {
    const method = (init?.method || "GET").toLowerCase() as any;

    const res = await api.request<T>({
      url,
      method,
      data: init?.body,
      headers: init?.headers as any,
    });

    return res.data;
  } catch (err: any) {
    throw new Error(getApiErrorMessage(err, "Không gọi được API SMS định kỳ."));
  }
}

const AdminSmsScheduleMonitor: React.FC = () => {
  const [tab, setTab] = useState<"configs" | "jobs" | "history">("configs");
  const [status, setStatus] = useState("pending");
  const [serial, setSerial] = useState("");
  const [enabledFilter, setEnabledFilter] = useState<"all" | "on" | "off">("all");

  const [configs, setConfigs] = useState<SmsConfig[]>([]);
  const [jobs, setJobs] = useState<SmsJob[]>([]);
  const [history, setHistory] = useState<SmsHistory[]>([]);

  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stats = useMemo(() => {
    const totalConfigs = configs.length;
    const activeConfigs = configs.filter((x) => x.enabled).length;
    const pendingJobs = jobs.filter((x) => (x.status || "").toLowerCase() === "pending").length;
    const successHistory = history.filter((x) => x.success).length;

    return { totalConfigs, activeConfigs, pendingJobs, successHistory };
  }, [configs, jobs, history]);

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const qsConfig = new URLSearchParams({ take: "200" });
      const qsJob = new URLSearchParams({ status, take: "150" });
      const qsHistory = new URLSearchParams({ take: "150" });

      const serialKey = serial.trim().toUpperCase();

      if (serialKey) {
        qsConfig.set("search", serialKey);
        qsJob.set("serial", serialKey);
        qsHistory.set("serial", serialKey);
      }

      if (enabledFilter === "on") qsConfig.set("enabled", "true");
      if (enabledFilter === "off") qsConfig.set("enabled", "false");

      const [cfgJson, jobJson, hisJson] = await Promise.all([
        apiFetchJson<ApiList<SmsConfig>>(
          `/api/admin/sms-schedule/configs?${qsConfig.toString()}`
        ),
        apiFetchJson<ApiList<SmsJob>>(
          `/api/admin/sms-schedule/jobs?${qsJob.toString()}`
        ),
        apiFetchJson<ApiList<SmsHistory>>(
          `/api/admin/sms-schedule/history?${qsHistory.toString()}`
        ),
      ]);

      setConfigs(Array.isArray(cfgJson.items) ? cfgJson.items : []);
      setJobs(Array.isArray(jobJson.items) ? jobJson.items : []);
      setHistory(Array.isArray(hisJson.items) ? hisJson.items : []);
    } catch (err: any) {
      setError(err?.message || "Không tải được dữ liệu SMS định kỳ.");
      setConfigs([]);
      setJobs([]);
      setHistory([]);
    } finally {
      setLoading(false);
    }
  };

  const toggleConfig = async (cfg: SmsConfig) => {
    if (!cfg.id) return;

    const next = !cfg.enabled;
    setBusyId(cfg.id);
    setError(null);

    try {
      const data = await apiFetchJson<ApiAction>(
        `/api/admin/sms-schedule/configs/${encodeURIComponent(cfg.id)}/toggle?enabled=${next}`,
        {
          method: "PATCH",
        }
      );

      if (data?.ok === false) {
        throw new Error(data.message || "Cập nhật quyền thất bại.");
      }

      setConfigs((prev) =>
        prev.map((x) =>
          x.id === cfg.id
            ? {
                ...x,
                enabled: next,
                updatedAtUtc: new Date().toISOString(),
              }
            : x
        )
      );
    } catch (err: any) {
      setError(err?.message || "Không cập nhật được quyền SMS.");
    } finally {
      setBusyId(null);
    }
  };

  useEffect(() => {
    void load();
    
  }, [status, enabledFilter]);
  return (
    <main className="admin-sms-monitor">
      <div className="admin-sms-monitor__head">
        <div>
          <div className="admin-sms-monitor__eyebrow">Admin SMS Permission</div>
          <h1>Quản lý quyền SMS định kỳ</h1>
          <p>
            Admin bật/tắt quyền lịch SMS, theo dõi queue và lịch sử gửi.
            User vẫn là người tự cài khung giờ ở trang người dùng.
          </p>
        </div>

        <button className="admin-sms-monitor__reload" onClick={load} disabled={loading}>
          {loading ? "Đang tải..." : "Tải lại"}
        </button>
      </div>

      <div className="admin-sms-monitor__stats">
        <div>
          <span>Tổng lịch user</span>
          <strong>{stats.totalConfigs}</strong>
        </div>
        <div>
          <span>Đang bật quyền</span>
          <strong>{stats.activeConfigs}</strong>
        </div>
        <div>
          <span>Job đang chờ</span>
          <strong>{stats.pendingJobs}</strong>
        </div>
        <div>
          <span>Lịch sử thành công</span>
          <strong>{stats.successHistory}</strong>
        </div>
      </div>

      <div className="admin-sms-monitor__filters">
        <input
          value={serial}
          onChange={(e) => setSerial(e.target.value)}
          placeholder="Tìm serial..."
        />

        <select value={enabledFilter} onChange={(e) => setEnabledFilter(e.target.value as any)}>
          <option value="all">Tất cả quyền</option>
          <option value="on">Đang bật</option>
          <option value="off">Đã tắt</option>
        </select>

        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="pending">Job chờ gửi</option>
          <option value="processing">Job đang xử lý</option>
          <option value="sent">Job đã gửi</option>
          <option value="failed">Job lỗi</option>
          <option value="all">Tất cả job</option>
        </select>

        <button onClick={load} disabled={loading}>
          Lọc
        </button>
      </div>

      {error && <div className="admin-sms-monitor__error">{error}</div>}

      <div className="admin-sms-monitor__tabs">
        <button className={tab === "configs" ? "is-active" : ""} onClick={() => setTab("configs")}>
          Quyền user
        </button>
        <button className={tab === "jobs" ? "is-active" : ""} onClick={() => setTab("jobs")}>
          Queue SMS
        </button>
        <button className={tab === "history" ? "is-active" : ""} onClick={() => setTab("history")}>
          Lịch sử gửi
        </button>
      </div>

      {tab === "configs" && (
        <section className="admin-sms-monitor__panel">
          <div className="admin-sms-monitor__toolbar">
            <h2>Quyền SMS định kỳ của user</h2>
            <span>{configs.length} cấu hình</span>
          </div>

          <div className="admin-sms-monitor__table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Serial</th>
                  <th>Khung giờ</th>
                  <th>Trạng thái</th>
                  <th>Đổi gần nhất</th>
                  <th>Cập nhật</th>
                  <th>Quyền</th>
                </tr>
              </thead>
              <tbody>
                {configs.length === 0 ? (
                  <tr>
                    <td colSpan={7}>Chưa có user cài SMS định kỳ.</td>
                  </tr>
                ) : (
                  configs.map((c, idx) => (
                    <tr key={c.id || idx}>
                      <td>
                        <div className="admin-sms-monitor__user">
                          <strong>{c.email || c.username || "—"}</strong>
                          <span>{c.userId || "—"}</span>
                        </div>
                      </td>
                      <td><code>{c.serialNumber || "—"}</code></td>
                      <td>{(c.scheduleTimes || []).join(" · ") || "—"}</td>
                      <td>
                        <span className={`admin-sms-monitor__badge ${c.enabled ? "is-sent" : "is-failed"}`}>
                          {c.enabled ? "Đang bật" : "Đã tắt"}
                        </span>
                      </td>
                      <td>{fmt(c.lastChangedAtUtc)}</td>
                      <td>{fmt(c.updatedAtUtc)}</td>
                      <td>
                        <button
                          className={`admin-sms-monitor__toggle ${c.enabled ? "is-on" : "is-off"}`}
                          onClick={() => toggleConfig(c)}
                          disabled={busyId === c.id}
                        >
                          {busyId === c.id ? "Đang lưu..." : c.enabled ? "Tắt quyền" : "Bật quyền"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "jobs" && (
        <section className="admin-sms-monitor__panel">
          <div className="admin-sms-monitor__toolbar">
            <h2>Queue SMS</h2>
            <span>{jobs.length} job</span>
          </div>

          <div className="admin-sms-monitor__table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Serial</th>
                  <th>SĐT</th>
                  <th>Giờ hẹn</th>
                  <th>Run at</th>
                  <th>Trạng thái</th>
                  <th>Retry</th>
                  <th>Lỗi</th>
                </tr>
              </thead>
              <tbody>
                {jobs.length === 0 ? (
                  <tr>
                    <td colSpan={7}>Không có job.</td>
                  </tr>
                ) : (
                  jobs.map((j, idx) => {
                    const st = (j.status || "none").toLowerCase();

                    return (
                      <tr key={j.id || j.jobKey || idx}>
                        <td><code>{j.serialNumber || "—"}</code></td>
                        <td>{maskPhone(j.phone)}</td>
                        <td>{j.scheduleTime || "—"}</td>
                        <td>{fmt(j.runAtUtc)}</td>
                        <td>
                          <span className={`admin-sms-monitor__badge is-${st}`}>
                            {statusText[st] || j.status || "—"}
                          </span>
                        </td>
                        <td>{j.retryCount ?? 0}</td>
                        <td className="admin-sms-monitor__err-cell">{j.lastError || "—"}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "history" && (
        <section className="admin-sms-monitor__panel">
          <div className="admin-sms-monitor__toolbar">
            <h2>History gửi SMS</h2>
            <span>{history.length} bản ghi</span>
          </div>

          <div className="admin-sms-monitor__table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Serial</th>
                  <th>SĐT</th>
                  <th>Giờ hẹn</th>
                  <th>Nhiệt độ</th>
                  <th>Độ ẩm</th>
                  <th>Reading at</th>
                  <th>Kết quả</th>
                  <th>Gửi lúc</th>
                </tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={8}>Chưa có lịch sử.</td>
                  </tr>
                ) : (
                  history.map((h, idx) => (
                    <tr key={h.id || idx}>
                      <td><code>{h.serialNumber || "—"}</code></td>
                      <td>{maskPhone(h.phone)}</td>
                      <td>{h.scheduleTime || "—"}</td>
                      <td>{h.temperature == null ? "—" : `${h.temperature}°C`}</td>
                      <td>{h.humidity == null ? "—" : `${h.humidity}%`}</td>
                      <td>{fmt(h.readingAtUtc)}</td>
                      <td>
                        <span className={`admin-sms-monitor__badge ${h.success ? "is-sent" : "is-failed"}`}>
                          {h.success ? "Thành công" : h.error || "Thất bại"}
                        </span>
                      </td>
                      <td>{fmt(h.sentAtUtc || h.createdAtUtc)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
};

export default AdminSmsScheduleMonitor;