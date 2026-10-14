// src/pages/Admin/SubscriptionsPage.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { adminListSubs, type AdminSubsItem } from "../../api/subscriptions";
import "../../styles/Admin/CodeService/SubscriptionsPage.css";

type Status = "" | "active" | "expired";
type SortKey = "user" | "plan" | "start" | "end" | "days";
type SortDir = "asc" | "desc";

const NEAR_THRESHOLD = 20;

const strip = (value?: string | null) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const fmtDateTime = (iso?: string) => {
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

const initials = (name?: string | null, email?: string | null) => {
  const src = (name || email || "U").trim();
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : src.slice(0, 2)).toUpperCase();
};

const displayUser = (it: AdminSubsItem) =>
  it.userName?.trim() || it.email?.trim() || "Người dùng chưa rõ";

const isNearExpiry = (it: AdminSubsItem) =>
  it.isActive &&
  Number.isFinite(it.daysLeft) &&
  Number(it.daysLeft) > 0 &&
  Number(it.daysLeft) <= NEAR_THRESHOLD;

const dayPercent = (daysLeft: number) => {
  if (!Number.isFinite(daysLeft) || daysLeft <= 0) return 0;
  return Math.max(4, Math.min(100, Math.round((daysLeft / 365) * 100)));
};

export default function SubscriptionsPage() {
  const [status, setStatus] = useState<Status>("");
  const [items, setItems] = useState<AdminSubsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [planFilter, setPlanFilter] = useState("");
  const [nearOnly, setNearOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("start");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);

    try {
      const res = await adminListSubs(status || undefined);
      setItems(Array.isArray(res.items) ? res.items : []);
    } catch (e: any) {
      console.error(e);
      setItems([]);
      setErr(
        e?.response?.data?.message ||
          e?.message ||
          "Không tải được danh sách subscriptions."
      );
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const stats = useMemo(() => {
    const total = items.length;
    const active = items.filter((x) => x.isActive).length;
    const expired = total - active;
    const near = items.filter(isNearExpiry).length;
    const avgDays = active
      ? Math.round(
          items
            .filter((x) => x.isActive)
            .reduce((sum, x) => sum + (Number(x.daysLeft) || 0), 0) / active
        )
      : 0;

    return { total, active, expired, near, avgDays };
  }, [items]);

  const planOptions = useMemo(() => {
    const s = new Set<string>();
    items.forEach((x) => s.add((x.plan || "basic").toLowerCase()));
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = strip(query);

    return items
      .filter((it) => {
        if (!planFilter) return true;
        return (it.plan || "basic").toLowerCase() === planFilter;
      })
      .filter((it) => (nearOnly ? isNearExpiry(it) : true))
      .filter((it) => {
        if (!q) return true;
        const haystack = [
          it.userId,
          it.userName,
          it.email,
          it.plan,
          Array.isArray(it.features) ? it.features.join(" ") : "",
          it.isActive ? "active dang hoat dong" : "inactive expired het han",
        ]
          .map((x) => strip(String(x ?? "")))
          .join(" ");
        return haystack.includes(q);
      })
      .sort((a, b) => {
        const dir = sortDir === "asc" ? 1 : -1;

        if (sortKey === "start") {
          const ta = a.startedAtUtc ? new Date(a.startedAtUtc).getTime() : 0;
          const tb = b.startedAtUtc ? new Date(b.startedAtUtc).getTime() : 0;
          return (ta - tb) * dir;
        }

        if (sortKey === "end") {
          const ta = a.endsAtUtc ? new Date(a.endsAtUtc).getTime() : 0;
          const tb = b.endsAtUtc ? new Date(b.endsAtUtc).getTime() : 0;
          return (ta - tb) * dir;
        }

        if (sortKey === "days") {
          return ((Number(a.daysLeft) || 0) - (Number(b.daysLeft) || 0)) * dir;
        }

        if (sortKey === "plan") {
          return (a.plan || "basic").localeCompare(b.plan || "basic") * dir;
        }

        return displayUser(a).localeCompare(displayUser(b)) * dir;
      });
  }, [items, query, planFilter, nearOnly, sortKey, sortDir]);

  const changeSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(key === "user" || key === "plan" ? "asc" : "desc");
  };

  const sortMark = (key: SortKey) => {
    if (sortKey !== key) return "↕";
    return sortDir === "asc" ? "↑" : "↓";
  };

  const renderFeatures = (features?: string[]) => {
    if (!Array.isArray(features) || features.length === 0) {
      return <span className="sdx-muted">Không có</span>;
    }

    return (
      <div className="sdx-features">
        {features.slice(0, 4).map((f) => (
          <span key={f} className="sdx-feature-chip">
            {f}
          </span>
        ))}
        {features.length > 4 && (
          <span className="sdx-feature-chip sdx-feature-chip--more">
            +{features.length - 4}
          </span>
        )}
      </div>
    );
  };

  const renderDays = (it: AdminSubsItem) => {
    const days = Number.isFinite(it.daysLeft) ? Number(it.daysLeft) : 0;
    const near = isNearExpiry(it);
    const expired = !it.isActive || days <= 0;

    return (
      <div className={`sdx-days ${near ? "is-near" : ""} ${expired ? "is-expired" : ""}`}>
        <div className="sdx-days-top">
          <strong>{days}</strong>
          <span>ngày</span>
        </div>
        <div className="sdx-days-bar" aria-hidden="true">
          <span style={{ width: `${dayPercent(days)}%` }} />
        </div>
        {near && <em>Sắp hết hạn</em>}
        {expired && <em>Hết hạn</em>}
      </div>
    );
  };

  return (
    <div className="subs-container sdx-page">
      <header className="sdx-hero">
        <div className="sdx-hero-main">
          <div className="sdx-logo-wrap">
            <img src="/Pictures/logo.png" alt="Logo công ty" className="sdx-logo" />
          </div>

          <div className="sdx-heading">
            <span className="sdx-kicker">SUBSCRIPTION COMMAND CENTER</span>
            <h1>Quản lý thuê bao dịch vụ</h1>
            <p>
              Theo dõi gói đang hoạt động, ngày hết hạn, quyền tính năng và các tài khoản cần xử lý sớm.
            </p>
          </div>
        </div>

        <div className="sdx-hero-actions">
          <button type="button" className="sdx-back" onClick={() => (window.location.href = "/admin")}>
            ← Admin
          </button>
          <button type="button" className="sdx-refresh" onClick={reload} disabled={loading}>
            {loading ? "Đang tải..." : "Tải lại"}
          </button>
        </div>
      </header>

      <section className="sdx-stats" aria-label="Tổng quan thuê bao">
        <article className="sdx-stat-card is-total">
          <span>Tổng thuê bao</span>
          <strong>{stats.total}</strong>
          <small>trong bộ lọc hiện tại</small>
        </article>
        <article className="sdx-stat-card is-active">
          <span>Đang hoạt động</span>
          <strong>{stats.active}</strong>
          <small>{stats.total ? Math.round((stats.active / stats.total) * 100) : 0}% tổng số</small>
        </article>
        <article className="sdx-stat-card is-near">
          <span>Sắp hết hạn</span>
          <strong>{stats.near}</strong>
          <small>≤ {NEAR_THRESHOLD} ngày</small>
        </article>
        <article className="sdx-stat-card is-days">
          <span>Ngày còn lại TB</span>
          <strong>{stats.avgDays}</strong>
          <small>tài khoản active</small>
        </article>
      </section>

      <section className="sdx-control-deck">
        <div className="sdx-tabs" role="tablist" aria-label="Lọc trạng thái thuê bao">
          <button
            type="button"
            className={`sdx-tab ${status === "" ? "is-active" : ""}`}
            onClick={() => setStatus("")}
          >
            Tất cả <b>{stats.total}</b>
          </button>
          <button
            type="button"
            className={`sdx-tab ${status === "active" ? "is-active" : ""}`}
            onClick={() => setStatus("active")}
          >
            Active <b>{stats.active}</b>
          </button>
          <button
            type="button"
            className={`sdx-tab ${status === "expired" ? "is-active" : ""}`}
            onClick={() => setStatus("expired")}
          >
            Expired <b>{stats.expired}</b>
          </button>
        </div>

        <div className="sdx-tools">
          <label className="sdx-search">
            <span>⌕</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm user, email, plan, feature..."
            />
          </label>

          <select
            className="sdx-select"
            value={planFilter}
            onChange={(e) => setPlanFilter(e.target.value)}
            aria-label="Lọc theo plan"
          >
            <option value="">Tất cả plan</option>
            {planOptions.map((p) => (
              <option key={p} value={p}>
                {p.toUpperCase()}
              </option>
            ))}
          </select>

          <button
            type="button"
            className={`sdx-near-toggle ${nearOnly ? "is-active" : ""}`}
            onClick={() => setNearOnly((v) => !v)}
          >
            ⚠ Sắp hết hạn
          </button>
        </div>
      </section>

      {err && <div className="sdx-error">{err}</div>}

      <section className={`sdx-data-card ${loading ? "is-loading" : ""}`}>
        <div className="sdx-data-head">
          <div>
            <h2>Danh sách thuê bao</h2>
            <p>
              Đang hiển thị <b>{filteredItems.length}</b> / {items.length} tài khoản
            </p>
          </div>
          <div className="sdx-sort-hint">Nhấn tiêu đề cột để sắp xếp</div>
        </div>

        <div className="sdx-table-wrap">
          <table className="sdx-table">
            <thead>
              <tr>
                <th>
                  <button type="button" onClick={() => changeSort("user")}>
                    User {sortMark("user")}
                  </button>
                </th>
                <th>
                  <button type="button" onClick={() => changeSort("plan")}>
                    Plan {sortMark("plan")}
                  </button>
                </th>
                <th>Features</th>
                <th>
                  <button type="button" onClick={() => changeSort("start")}>
                    Start {sortMark("start")}
                  </button>
                </th>
                <th>
                  <button type="button" onClick={() => changeSort("end")}>
                    End {sortMark("end")}
                  </button>
                </th>
                <th>
                  <button type="button" onClick={() => changeSort("days")}>
                    Days {sortMark("days")}
                  </button>
                </th>
                <th>Trạng thái</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                Array.from({ length: 7 }).map((_, i) => (
                  <tr key={i} className="sdx-skeleton-row">
                    <td colSpan={7}><span /></td>
                  </tr>
                ))
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="sdx-empty">
                      <div>🛰️</div>
                      <h3>Không có subscription phù hợp</h3>
                      <p>Thử đổi trạng thái, plan hoặc từ khóa tìm kiếm.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredItems.map((it, idx) => {
                  const name = displayUser(it);
                  const near = isNearExpiry(it);
                  const key = `${it.userId}-${it.startedAtUtc || ""}-${idx}`;

                  return (
                    <tr key={key} className={near ? "is-near" : undefined}>
                      <td>
                        <div className="sdx-user-cell">
                          <span className="sdx-avatar">{initials(it.userName, it.email)}</span>
                          <div>
                            <strong>{name}</strong>
                            <small>{it.userId}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`sdx-plan sdx-plan--${(it.plan || "basic").toLowerCase()}`}>
                          {(it.plan || "basic").toUpperCase()}
                        </span>
                      </td>
                      <td>{renderFeatures(it.features)}</td>
                      <td>{fmtDateTime(it.startedAtUtc)}</td>
                      <td>{fmtDateTime(it.endsAtUtc)}</td>
                      <td>{renderDays(it)}</td>
                      <td>
                        <span className={`sdx-status ${it.isActive ? "is-active" : "is-inactive"}`}>
                          {it.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="sdx-mobile-list">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => <div key={i} className="sdx-mobile-skeleton" />)
          ) : filteredItems.length === 0 ? (
            <div className="sdx-empty">
              <div>🛰️</div>
              <h3>Không có subscription phù hợp</h3>
              <p>Thử đổi trạng thái, plan hoặc từ khóa tìm kiếm.</p>
            </div>
          ) : (
            filteredItems.map((it, idx) => {
              const key = `m-${it.userId}-${it.startedAtUtc || ""}-${idx}`;
              return (
                <article key={key} className={`sdx-mobile-card ${isNearExpiry(it) ? "is-near" : ""}`}>
                  <div className="sdx-mobile-top">
                    <span className="sdx-avatar">{initials(it.userName, it.email)}</span>
                    <div>
                      <h3>{displayUser(it)}</h3>
                      <p>{it.email || it.userId}</p>
                    </div>
                    <span className={`sdx-status ${it.isActive ? "is-active" : "is-inactive"}`}>
                      {it.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>

                  <div className="sdx-mobile-grid">
                    <div><span>Plan</span><b>{(it.plan || "basic").toUpperCase()}</b></div>
                    <div><span>Còn lại</span>{renderDays(it)}</div>
                    <div><span>Bắt đầu</span><b>{fmtDateTime(it.startedAtUtc)}</b></div>
                    <div><span>Kết thúc</span><b>{fmtDateTime(it.endsAtUtc)}</b></div>
                  </div>

                  {renderFeatures(it.features)}
                </article>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
