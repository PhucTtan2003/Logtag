// src/pages/admin/AdminSmsActivationsPage.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "../../api/axios";
import "../../styles/Admin/CodeService/AdminsmsAtivationPage.css";

type Item = {
  id: string;
  userId: string;
  email?: string;
  name?: string;
  phone: string;
  activatedAtUtc: string;
  licenseCode?: string;
  notes?: string;
};

type DateFilter = "all" | "today" | "last7" | "last30";
type SortKey = "latest" | "oldest" | "name";

const dateFilters: Array<{ key: DateFilter; label: string; hint: string }> = [
  { key: "all", label: "Tất cả", hint: "Toàn bộ" },
  { key: "today", label: "Hôm nay", hint: "Trong ngày" },
  { key: "last7", label: "7 ngày", hint: "Tuần này" },
  { key: "last30", label: "30 ngày", hint: "Tháng này" },
];

function normalizeText(input?: string | null) {
  return String(input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function safeDate(utc?: string) {
  if (!utc) return null;
  const d = new Date(utc);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(utc?: string) {
  const d = safeDate(utc);
  if (!d) return "—";
  return d.toLocaleString("vi-VN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDateOnly(utc?: string) {
  const d = safeDate(utc);
  if (!d) return "—";
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const dKey = d.toISOString().slice(0, 10);
  const todayKey = today.toISOString().slice(0, 10);
  const yesterdayKey = yesterday.toISOString().slice(0, 10);

  if (dKey === todayKey) return "Hôm nay";
  if (dKey === yesterdayKey) return "Hôm qua";

  return d.toLocaleDateString("vi-VN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function fromNow(utc?: string) {
  const d = safeDate(utc);
  if (!d) return "—";

  const diffMs = d.getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat("vi", { numeric: "auto" });
  const diffMin = Math.round(diffMs / 60000);

  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");

  const diffHour = Math.round(diffMin / 60);
  if (Math.abs(diffHour) < 24) return rtf.format(diffHour, "hour");

  const diffDay = Math.round(diffHour / 24);
  return rtf.format(diffDay, "day");
}

function isInDateRange(utc: string, dateFilter: DateFilter) {
  if (dateFilter === "all") return true;

  const d = safeDate(utc);
  if (!d) return false;

  const now = new Date();
  const dayMs = 1000 * 60 * 60 * 24;
  const diffDays = (now.getTime() - d.getTime()) / dayMs;

  if (dateFilter === "today") {
    return d.toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
  }

  if (dateFilter === "last7") return diffDays <= 7;
  if (dateFilter === "last30") return diffDays <= 30;

  return true;
}

function getInitial(name?: string, email?: string, phone?: string) {
  const src = (name || email || phone || "S").trim();
  return src.slice(0, 1).toUpperCase();
}

function maskPhone(phone?: string) {
  const p = String(phone ?? "").trim();
  if (p.length <= 5) return p || "—";
  return `${p.slice(0, 4)} ${p.slice(4, 7)} ${p.slice(7)}`.trim();
}

function groupByDay(items: Item[]) {
  const map = new Map<string, Item[]>();

  for (const item of items) {
    const key = formatDateOnly(item.activatedAtUtc);
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }

  return Array.from(map.entries());
}

export default function AdminSmsActivationsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("latest");
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const resp = await api.get("/api/admin/sms-activations", {
        params: { search: search.trim(), skip: 0, take: 200 },
      });

      const raw: Item[] = Array.isArray(resp.data?.items) ? resp.data.items : [];

      const normalized = raw
        .map((x: any, index) => ({
          id: String(x.id ?? x._id ?? `${x.userId ?? "user"}-${x.phone ?? "phone"}-${index}`),
          userId: String(x.userId ?? ""),
          email: x.email ? String(x.email) : undefined,
          name: x.name ? String(x.name) : undefined,
          phone: String(x.phone ?? ""),
          activatedAtUtc: String(x.activatedAtUtc ?? x.createdAtUtc ?? x.createdAt ?? ""),
          licenseCode: x.licenseCode ? String(x.licenseCode) : undefined,
          notes: x.notes ? String(x.notes) : undefined,
        }))
        .sort(
          (a, b) =>
            (safeDate(b.activatedAtUtc)?.getTime() ?? 0) -
            (safeDate(a.activatedAtUtc)?.getTime() ?? 0)
        );

      setItems(normalized);
      setSelectedItem((current) => {
        if (current && normalized.some((x) => x.id === current.id)) return current;
        return normalized[0] ?? null;
      });
      setLastRefreshed(new Date());
    } catch (err: any) {
      console.error(err);
      setError(
        err?.response?.data?.message ||
          err?.response?.data ||
          err?.message ||
          "Không lấy được danh sách SMS activations."
      );
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const uniqueUsers = new Set(items.map((x) => x.userId).filter(Boolean)).size;
    const today = items.filter((x) => isInDateRange(x.activatedAtUtc, "today")).length;
    const last7 = items.filter((x) => isInDateRange(x.activatedAtUtc, "last7")).length;
    const withLicense = items.filter((x) => !!x.licenseCode).length;
    const lastActivated = items[0]?.activatedAtUtc;

    return {
      total: items.length,
      uniqueUsers,
      today,
      last7,
      withLicense,
      lastActivated,
    };
  }, [items]);

  const clientFilteredItems = useMemo(() => {
    const keyword = normalizeText(search);

    let next = items.filter((x) => isInDateRange(x.activatedAtUtc, dateFilter));

    if (keyword) {
      next = next.filter((x) =>
        [x.phone, x.name, x.email, x.userId, x.licenseCode, x.notes]
          .map(normalizeText)
          .some((v) => v.includes(keyword))
      );
    }

    next = [...next].sort((a, b) => {
      if (sortKey === "name") {
        const an = normalizeText(a.name || a.email || a.phone || a.userId);
        const bn = normalizeText(b.name || b.email || b.phone || b.userId);
        return an.localeCompare(bn);
      }

      const at = safeDate(a.activatedAtUtc)?.getTime() ?? 0;
      const bt = safeDate(b.activatedAtUtc)?.getTime() ?? 0;
      return sortKey === "oldest" ? at - bt : bt - at;
    });

    return next;
  }, [items, dateFilter, search, sortKey]);

  const groupedItems = useMemo(() => groupByDay(clientFilteredItems), [clientFilteredItems]);

  useEffect(() => {
    if (!selectedItem && clientFilteredItems.length) {
      setSelectedItem(clientFilteredItems[0]);
      return;
    }

    if (selectedItem && !clientFilteredItems.some((x) => x.id === selectedItem.id)) {
      setSelectedItem(clientFilteredItems[0] ?? null);
    }
  }, [clientFilteredItems, selectedItem]);

  const copyText = async (value?: string) => {
    const text = String(value ?? "").trim();
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(text);
      window.setTimeout(() => setCopiedText(null), 1600);
    } catch {
      setCopiedText(null);
    }
  };

  const activeFilterMeta = dateFilters.find((x) => x.key === dateFilter);

  return (
    <div className="smsx-page">
      <div className="smsx-aurora" aria-hidden="true" />

      <header className="smsx-hero">
        <button
          type="button"
          className="smsx-back"
          onClick={() => (window.location.href = "/admin")}
        >
          <span>←</span>
          <span>Admin</span>
        </button>

        <div className="smsx-hero-main">
          <div className="smsx-kicker">SMS ACTIVATION COMMAND</div>
          <h1>Trung tâm kích hoạt SMS</h1>
          <p>
            Theo dõi tài khoản đã mở SMS, mã license đi kèm và lịch sử kích hoạt theo thời gian.
          </p>
        </div>

        <div className="smsx-live-card">
          <span className="smsx-live-dot" />
          <div>
            <b>{stats.lastActivated ? fromNow(stats.lastActivated) : "Chưa có dữ liệu"}</b>
            <span>Kích hoạt gần nhất</span>
          </div>
        </div>
      </header>

      <section className="smsx-stats" aria-label="Thống kê SMS activation">
        <article className="smsx-stat smsx-stat--primary">
          <span className="smsx-stat-label">Tổng kích hoạt</span>
          <strong>{stats.total}</strong>
          <small>{stats.withLicense} có license code</small>
        </article>

        <article className="smsx-stat">
          <span className="smsx-stat-label">User duy nhất</span>
          <strong>{stats.uniqueUsers}</strong>
          <small>Tài khoản đã mở dịch vụ</small>
        </article>

        <article className="smsx-stat">
          <span className="smsx-stat-label">Hôm nay</span>
          <strong>{stats.today}</strong>
          <small>Lượt kích hoạt trong ngày</small>
        </article>

        <article className="smsx-stat">
          <span className="smsx-stat-label">7 ngày gần đây</span>
          <strong>{stats.last7}</strong>
          <small>Xu hướng gần nhất</small>
        </article>
      </section>

      <section className="smsx-toolbar" aria-label="Bộ lọc SMS activation">
        <div className="smsx-search-wrap">
          <span className="smsx-search-icon">⌕</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void load();
            }}
            placeholder="Tìm SĐT, tên, email, userId, license..."
            className="smsx-search"
          />
          {search && (
            <button
              type="button"
              className="smsx-clear"
              onClick={() => setSearch("")}
              aria-label="Xóa tìm kiếm"
            >
              ×
            </button>
          )}
        </div>

        <div className="smsx-filter-pills" role="tablist" aria-label="Lọc theo thời gian">
          {dateFilters.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`smsx-pill ${dateFilter === f.key ? "is-active" : ""}`}
              onClick={() => setDateFilter(f.key)}
              role="tab"
              aria-selected={dateFilter === f.key}
            >
              <b>{f.label}</b>
              <span>{f.hint}</span>
            </button>
          ))}
        </div>

        <select
          className="smsx-sort"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          title="Sắp xếp"
        >
          <option value="latest">Mới nhất trước</option>
          <option value="oldest">Cũ nhất trước</option>
          <option value="name">Theo tên A-Z</option>
        </select>

        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="smsx-reload"
        >
          {loading ? "Đang tải..." : "Làm mới"}
        </button>
      </section>

      <div className="smsx-meta-row">
        <span>
          Đang xem <b>{clientFilteredItems.length}</b> bản ghi
          {activeFilterMeta ? ` • ${activeFilterMeta.label}` : ""}
        </span>
        <span>
          Cập nhật: <b>{lastRefreshed ? lastRefreshed.toLocaleString("vi-VN", { hour12: false }) : "—"}</b>
        </span>
      </div>

      {error && <div className="smsx-error">{String(error)}</div>}

      <main className="smsx-content">
        <section className="smsx-list-panel">
          {loading && items.length === 0 ? (
            <div className="smsx-skeleton-list" aria-label="Đang tải dữ liệu">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="smsx-skeleton-card" />
              ))}
            </div>
          ) : clientFilteredItems.length === 0 ? (
            <div className="smsx-empty">
              <div className="smsx-empty-icon">✦</div>
              <h3>Không có bản ghi phù hợp</h3>
              <p>Thử đổi bộ lọc thời gian hoặc tìm kiếm bằng số điện thoại / email khác.</p>
            </div>
          ) : (
            groupedItems.map(([day, list]) => (
              <div className="smsx-day-group" key={day}>
                <div className="smsx-day-title">
                  <span>{day}</span>
                  <b>{list.length}</b>
                </div>

                <div className="smsx-cards">
                  {list.map((item) => {
                    const isSelected = selectedItem?.id === item.id;
                    const displayName = item.name || item.email || item.userId || "Không rõ user";

                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`smsx-card ${isSelected ? "is-selected" : ""}`}
                        onClick={() => setSelectedItem(item)}
                      >
                        <span className="smsx-avatar">
                          {getInitial(item.name, item.email, item.phone)}
                        </span>

                        <span className="smsx-card-main">
                          <span className="smsx-card-top">
                            <strong>{displayName}</strong>
                            <em>{fromNow(item.activatedAtUtc)}</em>
                          </span>

                          <span className="smsx-card-phone">{maskPhone(item.phone)}</span>

                          <span className="smsx-card-tags">
                            {item.licenseCode ? (
                              <span className="smsx-tag smsx-tag--ok">{item.licenseCode}</span>
                            ) : (
                              <span className="smsx-tag smsx-tag--warn">Đã cấp mã</span>
                            )}
                            {item.email ? (
                              <span className="smsx-tag smsx-tag--soft">Có email</span>
                            ) : (
                              <span className="smsx-tag smsx-tag--muted">Thiếu email</span>
                            )}
                          </span>
                        </span>

                        <span className="smsx-card-arrow">›</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </section>

        <aside className="smsx-detail-panel">
          {selectedItem ? (
            <>
              <div className="smsx-detail-head">
                <span className="smsx-detail-avatar">
                  {getInitial(selectedItem.name, selectedItem.email, selectedItem.phone)}
                </span>
                <div>
                  <span className="smsx-detail-kicker">Selected account</span>
                  <h2>{selectedItem.name || selectedItem.email || "Tài khoản SMS"}</h2>
                  <p>{selectedItem.userId}</p>
                </div>
              </div>

              <div className="smsx-detail-grid">
                <div className="smsx-detail-item smsx-detail-item--wide">
                  <span>Số điện thoại</span>
                  <button type="button" onClick={() => copyText(selectedItem.phone)}>
                    {maskPhone(selectedItem.phone)}
                  </button>
                </div>

                <div className="smsx-detail-item smsx-detail-item--wide">
                  <span>Email</span>
                  <button type="button" onClick={() => copyText(selectedItem.email)}>
                    {selectedItem.email || "Chưa có email"}
                  </button>
                </div>

                <div className="smsx-detail-item">
                  <span>Kích hoạt lúc</span>
                  <b>{formatDate(selectedItem.activatedAtUtc)}</b>
                </div>

                <div className="smsx-detail-item">
                  <span>Khoảng thời gian</span>
                  <b>{fromNow(selectedItem.activatedAtUtc)}</b>
                </div>

                <div className="smsx-detail-item smsx-detail-item--wide">
                  <span>License code</span>
                  {selectedItem.licenseCode ? (
                    <button type="button" onClick={() => copyText(selectedItem.licenseCode)}>
                      {selectedItem.licenseCode}
                    </button>
                  ) : (
                    <b>Đã được cấp mã</b>
                  )}
                </div>

                <div className="smsx-detail-item smsx-detail-item--wide">
                  <span>Ghi chú</span>
                  <b>{selectedItem.notes || "Không có ghi chú"}</b>
                </div>
              </div>
            </>
          ) : (
            <div className="smsx-detail-empty">
              <span>◇</span>
              <p>Chọn một tài khoản để xem chi tiết.</p>
            </div>
          )}
        </aside>
      </main>

      {copiedText && (
        <div className="smsx-toast" role="status">
          Đã copy: {copiedText}
        </div>
      )}
    </div>
  );
}
