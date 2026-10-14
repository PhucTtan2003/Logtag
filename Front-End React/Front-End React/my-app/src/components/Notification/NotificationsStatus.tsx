import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock3,
  LayoutGrid,
  ListFilter,
  Loader2,
  RefreshCw,
  Search,
  Send,
  TimerReset,
  UserRound,
} from "lucide-react";
import api from "../../api/axios";
import "../../styles/NotificationsStatus.css";

interface NotificationStatus {
  notificationId: string;
  title: string;
  message: string;
  sentTo: string;
  sentAt: string;
  status?: string;
}

type StatusFilter = "all" | "pending" | "done";
type ViewMode = "compact" | "board";

const normalizeText = (s?: string) =>
  (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const isDoneStatus = (s?: string) => normalizeText(s) === "hoan thanh";

const safeDate = (input?: string) => {
  if (!input) return null;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
};

const safeDateTime = (input?: string) => {
  const d = safeDate(input);
  if (!d) return "—";
  return d.toLocaleString("vi-VN", { hour12: false });
};

const relativeTime = (input?: string) => {
  const d = safeDate(input);
  if (!d) return "Không rõ thời gian";

  const diffMs = d.getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat("vi", { numeric: "auto" });
  const minutes = Math.round(diffMs / 60000);
  const absMinutes = Math.abs(minutes);

  if (absMinutes < 60) return rtf.format(minutes, "minute");

  const hours = Math.round(diffMs / 3600000);
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");

  return rtf.format(Math.round(diffMs / 86400000), "day");
};

const dayKey = (input?: string) => {
  const d = safeDate(input);
  if (!d) return "unknown";
  return d.toISOString().slice(0, 10);
};

const dayLabel = (input?: string) => {
  const d = safeDate(input);
  if (!d) return "Chưa có ngày";

  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const ymd = (x: Date) => x.toISOString().slice(0, 10);
  if (ymd(d) === ymd(today)) return "Hôm nay";
  if (ymd(d) === ymd(yesterday)) return "Hôm qua";

  return d.toLocaleDateString("vi-VN");
};

const initials = (name?: string) => {
  const clean = (name || "?").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

const pickArray = (raw: any): NotificationStatus[] => {
  const src = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.data)
    ? raw.data
    : Array.isArray(raw?.items)
    ? raw.items
    : [];

  return src.map((x: any, idx: number) => ({
    notificationId: String(
      x.notificationId ?? x.id ?? x._id ?? `${x.sentAt ?? "task"}-${idx}`
    ),
    title: String(x.title ?? "Không có tiêu đề"),
    message: String(x.message ?? ""),
    sentTo: String(
      x.sentToName ??
        x.sentToFullName ??
        x.fullName ??
        x.sentTo ??
        x.userName ??
        x.email ??
        "Không rõ người nhận"
    ),
    sentAt: String(x.sentAt ?? x.createdAt ?? x.createAt ?? ""),
    status: String(x.status ?? x.taskStatus ?? "Đang xử lý"),
  }));
};

export default function NotificationStatusPanel() {
  const [data, setData] = useState<NotificationStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [view, setView] = useState<ViewMode>("compact");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setErr("");

    try {
      const res = await api.get("/api/admin/notifications-status", { signal });
      setData(pickArray(res.data));
    } catch (error: any) {
      if (error?.code === "ERR_CANCELED" || error?.name === "CanceledError") return;

      const status = error?.response?.status;
      const message =
        error?.response?.data?.message ||
        error?.response?.data ||
        error?.message ||
        "Không tải được trạng thái nhiệm vụ.";

      setErr(status ? `API lỗi ${status}: ${String(message)}` : String(message));
      console.error("Lỗi khi tải trạng thái nhiệm vụ:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void fetchData(ctrl.signal);
    return () => ctrl.abort();
  }, [fetchData]);

  const stats = useMemo(() => {
    const total = data.length;
    const done = data.filter((x) => isDoneStatus(x.status)).length;
    const pending = total - done;
    const rate = total ? Math.round((done / total) * 100) : 0;
    const latest = [...data].sort(
      (a, b) => (safeDate(b.sentAt)?.getTime() || 0) - (safeDate(a.sentAt)?.getTime() || 0)
    )[0];

    const uniqueReceivers = new Set(data.map((x) => normalizeText(x.sentTo)).filter(Boolean)).size;
    return { total, done, pending, rate, latest, uniqueReceivers };
  }, [data]);

  const filtered = useMemo(() => {
    const keyword = normalizeText(q);

    return data
      .filter((n) => {
        if (statusFilter === "done") return isDoneStatus(n.status);
        if (statusFilter === "pending") return !isDoneStatus(n.status);
        return true;
      })
      .filter((n) => {
        if (!keyword) return true;
        return [n.title, n.message, n.sentTo, n.status]
          .filter(Boolean)
          .some((f) => normalizeText(String(f)).includes(keyword));
      })
      .sort(
        (a, b) =>
          (safeDate(b.sentAt)?.getTime() || 0) -
          (safeDate(a.sentAt)?.getTime() || 0)
      );
  }, [data, q, statusFilter]);

  const grouped = useMemo(() => {
    return filtered.reduce<Record<string, NotificationStatus[]>>((acc, item) => {
      const key = dayKey(item.sentAt);
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});
  }, [filtered]);

  const filterTabs: Array<{ key: StatusFilter; label: string; count: number }> = [
    { key: "all", label: "Tất cả", count: stats.total },
    { key: "pending", label: "Đang xử lý", count: stats.pending },
    { key: "done", label: "Hoàn thành", count: stats.done },
  ];

  const progressStyle = {
    "--ntx-progress": `${stats.rate}%`,
  } as React.CSSProperties;

  return (
    <section className="ntx-shell" aria-label="Trạng thái nhiệm vụ">
      <div className="ntx-topline">
        <div>
          <span className="ntx-kicker">Operations board</span>
          <h3>Trạng thái nhiệm vụ</h3>
          <p>Nhìn nhanh ai đã hoàn thành, mục nào còn treo và dòng việc mới nhất trong ngày.</p>
        </div>

        <button
          type="button"
          className="ntx-refresh"
          onClick={() => void fetchData()}
          disabled={loading}
        >
          {loading ? <Loader2 size={17} className="ntx-spin" /> : <RefreshCw size={17} />}
          {loading ? "Đang tải" : "Làm mới"}
        </button>
      </div>

      <div className="ntx-command-strip">
        <div className="ntx-rate" style={progressStyle}>
          <div className="ntx-rate-ring">
            <strong>{stats.rate}%</strong>
            <span>xong</span>
          </div>
          <div className="ntx-rate-copy">
            <b>Tiến độ chung</b>
            <span>{stats.done}/{stats.total || 0} nhiệm vụ đã hoàn thành</span>
            <div className="ntx-bar"><i /></div>
          </div>
        </div>

        <div className="ntx-mini-stats">
          <article>
            <Send size={18} />
            <span>Tổng</span>
            <b>{stats.total}</b>
          </article>
          <article>
            <TimerReset size={18} />
            <span>Còn xử lý</span>
            <b>{stats.pending}</b>
          </article>
          <article>
            <UserRound size={18} />
            <span>Người nhận</span>
            <b>{stats.uniqueReceivers}</b>
          </article>
          <article>
            <Clock3 size={18} />
            <span>Gần nhất</span>
            <b>{stats.latest ? relativeTime(stats.latest.sentAt) : "—"}</b>
          </article>
        </div>
      </div>

      <div className="ntx-toolbar">
        <label className="ntx-search">
          <Search size={17} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm tiêu đề, nội dung, người nhận..."
          />
        </label>

        <div className="ntx-tabs" role="tablist" aria-label="Lọc trạng thái">
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={statusFilter === tab.key}
              className={statusFilter === tab.key ? "is-active" : ""}
              onClick={() => setStatusFilter(tab.key)}
            >
              {tab.label}
              <b>{tab.count}</b>
            </button>
          ))}
        </div>

        <div className="ntx-view-toggle" aria-label="Đổi kiểu hiển thị">
          <button
            type="button"
            className={view === "compact" ? "is-active" : ""}
            onClick={() => setView("compact")}
            title="Dạng danh sách gọn"
          >
            <ListFilter size={16} />
          </button>
          <button
            type="button"
            className={view === "board" ? "is-active" : ""}
            onClick={() => setView("board")}
            title="Dạng bảng card"
          >
            <LayoutGrid size={16} />
          </button>
        </div>
      </div>

      {err && (
        <div className="ntx-error">
          <AlertCircle size={17} />
          <span>{err}</span>
        </div>
      )}

      {loading && data.length === 0 ? (
        <div className="ntx-loading">
          <Loader2 size={22} className="ntx-spin" />
          Đang tải dữ liệu nhiệm vụ...
        </div>
      ) : (
        <div className={`ntx-content ntx-content--${view}`}>
          <div className="ntx-content-head">
            <span>{filtered.length} nhiệm vụ khớp bộ lọc</span>
            <small>{q.trim() ? `Từ khóa: “${q.trim()}”` : "Sắp xếp theo mới nhất"}</small>
          </div>

          {Object.entries(grouped).map(([key, items]) => (
            <div key={key} className="ntx-day-section">
              <div className="ntx-day-label">{dayLabel(items[0]?.sentAt)}</div>

              <div className="ntx-task-list">
                {items.map((n) => {
                  const done = isDoneStatus(n.status);
                  const expanded = expandedId === n.notificationId;

                  return (
                    <article key={n.notificationId} className={`ntx-task ${done ? "is-done" : "is-pending"}`}>
                      <div className="ntx-task-avatar">{initials(n.sentTo)}</div>

                      <div className="ntx-task-main">
                        <div className="ntx-task-line">
                          <h4>{n.title}</h4>
                          <span className={`ntx-status ${done ? "is-done" : "is-pending"}`}>
                            {done ? "Hoàn thành" : n.status || "Đang xử lý"}
                          </span>
                        </div>

                        <div className="ntx-meta">
                          <span><UserRound size={13} /> {n.sentTo || "—"}</span>
                          <span><Clock3 size={13} /> {safeDateTime(n.sentAt)}</span>
                        </div>

                        <p className={expanded ? "is-expanded" : ""}>
                          {n.message || "Không có nội dung."}
                        </p>
                      </div>

                      <button
                        type="button"
                        className="ntx-expand"
                        onClick={() => setExpandedId(expanded ? null : n.notificationId)}
                        aria-label={expanded ? "Thu gọn nhiệm vụ" : "Mở rộng nhiệm vụ"}
                      >
                        <ChevronDown size={17} className={expanded ? "is-open" : ""} />
                      </button>
                    </article>
                  );
                })}
              </div>
            </div>
          ))}

          {!loading && filtered.length === 0 && (
            <div className="ntx-empty">
              <CheckCircle2 size={42} />
              <strong>Không có nhiệm vụ phù hợp</strong>
              <span>Thử đổi trạng thái hoặc tìm bằng từ khóa khác.</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}