import React, { useMemo, useState } from "react";
import { CheckCircle2, Clock3, Megaphone, User, Users } from "lucide-react";
import "../styles/NotificationsStatus.css";

interface NotificationTask {
  notificationId: string;
  title: string;
  message: string;
  sentAt: string;
  // sentTo có thể là string / ObjectId("...") / { $oid } / {_id} / mảng / null
  sentTo: any;
  status: string;
}

interface TaskListProps {
  notifications: NotificationTask[];
  /** ID bạn đang có ở trên UI (thường là accountId). Vẫn truyền như cũ. */
  accountId: string;
  handleUpdateStatus: (notificationId: string, newStatus: string) => void;
}

/* ========= Helpers: chuẩn hóa ObjectId & so sánh ========= */
const normalizeId = (v: any): string | null => {
  if (v == null) return null;

  if (typeof v === "string") {
    // "ObjectId('...')" -> lấy phần 24-hex
    const m = v.match(/^ObjectId\(["']?([0-9a-fA-F]{24})["']?\)$/);
    return (m ? m[1] : v).trim();
  }

  if (typeof v === "object") {
    // Extended JSON { $oid: "..." }
    if (typeof (v as any)?.$oid === "string") return (v as any).$oid;
    // Trường hợp {_id: "..." }
    if (typeof (v as any)?._id === "string") return (v as any)._id;

    const s = v.toString?.();
    if (typeof s === "string") {
      const m = s.match(/^ObjectId\(["']?([0-9a-fA-F]{24})["']?\)$/);
      if (m) return m[1];
    }
  }

  return null;
};

const belongsToAny = (sentTo: any, myIds: string[]) => {
  const mySet = new Set(
    myIds
      .map(normalizeId)
      .filter(Boolean)
      .map((x) => (x as string).toLowerCase())
  );
  if (mySet.size === 0) return false;

  const arr = Array.isArray(sentTo) ? sentTo : [sentTo];
  for (const item of arr) {
    const nid = normalizeId(item);
    if (nid && mySet.has(nid.toLowerCase())) return true;
  }
  return false;
};

// Chuẩn hoá status (bỏ dấu, trim, lowercase)
const normStatus = (s: string) =>
  (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

// Thời gian tương đối (vi-VN)
const fromNow = (iso: string) => {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const rtf = new Intl.RelativeTimeFormat("vi", { numeric: "auto" });
    const min = Math.round(diff / 60000);
    if (Math.abs(min) < 60) return rtf.format(-min, "minute");
    const hr = Math.round(min / 60);
    if (Math.abs(hr) < 24) return rtf.format(-hr, "hour");
    const day = Math.round(hr / 24);
    return rtf.format(-day, "day");
  } catch {
    return "";
  }
};

type FilterKey = "all" | "mine" | "pending" | "done";

const TaskList: React.FC<TaskListProps> = ({
  notifications,
  accountId,
  handleUpdateStatus,
}) => {
  // 👇 ỨNG VIÊN ID: dùng cả accountId, userId, uid (nếu có) — không cần sửa Employee.tsx
  const idCandidates = Array.from(
    new Set(
      [
        accountId,
        localStorage.getItem("userId") || "",
        localStorage.getItem("uid") || "",
      ].filter(Boolean)
    )
  );

  const [filter, setFilter] = useState<FilterKey>("all");

  const enriched = useMemo(() => {
    return notifications.map((n) => {
      const isDone = normStatus(n.status) === "hoan thanh";
      const isMine = belongsToAny(n.sentTo, idCandidates);
      return { ...n, isDone, isMine };
    });
  }, [notifications, idCandidates]);

  const filtered = useMemo(() => {
    switch (filter) {
      case "mine":
        return enriched.filter((x) => x.isMine);
      case "pending":
        return enriched.filter((x) => !x.isDone);
      case "done":
        return enriched.filter((x) => x.isDone);
      default:
        return enriched;
    }
  }, [enriched, filter]);

  return (
    <section className="task-section">
      {/* Header đẹp + filter nhanh */}
      <div className="task-header">
        <div className="task-title-wrap">
          <h2>📌 Công việc hôm nay</h2>
          <span className="task-counter chip-outline">
            {filtered.length}/{notifications.length} mục
          </span>
        </div>

        <div className="task-filters" role="tablist" aria-label="Bộ lọc công việc">
          <button
            className={`pill ${filter === "all" ? "is-active" : ""}`}
            role="tab"
            aria-selected={filter === "all"}
            onClick={() => setFilter("all")}
          >
            <Megaphone size={16} className="pill-ic" /> Tất cả
          </button>
          <button
            className={`pill ${filter === "mine" ? "is-active" : ""}`}
            role="tab"
            aria-selected={filter === "mine"}
            onClick={() => setFilter("mine")}
          >
            <User size={16} className="pill-ic" /> Của tôi
          </button>
          <button
            className={`pill ${filter === "pending" ? "is-active" : ""}`}
            role="tab"
            aria-selected={filter === "pending"}
            onClick={() => setFilter("pending")}
          >
            <Clock3 size={16} className="pill-ic" /> Đang xử lý
          </button>
          <button
            className={`pill ${filter === "done" ? "is-active" : ""}`}
            role="tab"
            aria-selected={filter === "done"}
            onClick={() => setFilter("done")}
          >
            <CheckCircle2 size={16} className="pill-ic" /> Hoàn thành
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state" role="status" aria-live="polite">
          <img
            alt="Không có công việc"
            src="https://cdn.jsdelivr.net/gh/tabler/tabler-icons/icons/clipboard-off.svg"
          />
          <p>Không có mục nào khớp bộ lọc.</p>
        </div>
      ) : (
        <ul className="task-list">
          {filtered.map((n) => {
            return (
              <li
                key={n.notificationId}
                className={`task-item ${n.isDone ? "done" : "pending"}`}
              >
                <div className="task-left">
                  <div
                    className={`status-dot ${n.isDone ? "ok" : "warn"}`}
                    aria-hidden="true"
                  />
                  <div className="task-texts">
                    <div className="task-title-row">
                      <strong className="task-title">{n.title}</strong>
                      <span
                        className={`owner-badge ${
                          n.isMine ? "mine" : "public"
                        }`}
                        title={n.isMine ? "Giao cho bạn" : "Thông báo chung"}
                      >
                        {n.isMine ? (
                          <>
                            <User size={14} /> Của bạn
                          </>
                        ) : (
                          <>
                            <Users size={14} /> Thông báo chung
                          </>
                        )}
                      </span>
                    </div>
                    <p className="task-message">{n.message}</p>

                    <div className="task-meta">
                      <span className="task-time">
                        {n.sentAt ? fromNow(n.sentAt) : ""}
                      </span>
                      <span
                        className={`status-tag ${n.isDone ? "done" : "pending"}`}
                      >
                        {n.isDone ? "✔️ Hoàn thành" : "⏳ Đang xử lý"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="task-actions">
                  {n.isMine ? (
                    n.isDone ? (
                      <button
                        className="btn ghost mark-pending-btn"
                        onClick={() =>
                          handleUpdateStatus(n.notificationId, "Đang xử lý")
                        }
                        aria-label="Trở về đang xử lý"
                      >
                        🔄 Trở về đang xử lý
                      </button>
                    ) : (
                      <button
                        className="btn primary mark-done-btn"
                        onClick={() =>
                          handleUpdateStatus(n.notificationId, "Hoàn thành")
                        }
                        aria-label="Đánh dấu hoàn thành"
                      >
                        ✅ Đánh dấu hoàn thành
                      </button>
                    )
                  ) : (
                    <span className="status-tag muted">Thông báo chung</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default TaskList;
