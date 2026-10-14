// src/pages/Admin/ReadingArchive/ReadingArchivePage.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "../../../api/axios";
import "../../../styles/Admin/ReadingArchivePage.css";

type DataMode = "auto" | "raw" | "hourly" | "daily";
type ViewMode = "latest" | "history";
type StatusFilter = "all" | "online" | "offline";
type SortKey = "time-desc" | "time-asc" | "serial-asc" | "temp-desc" | "temp-asc";

type SummaryDto = {
  raw?: number;
  hourly?: number;
  daily?: number;
  latest?: number;
};

type LatestRow = {
  teamId?: string;
  serialNumber?: string;
  deviceName?: string;
  name?: string;
  lastTemperature?: number | null;
  temperature?: number | null;
  lastHumidity?: number | null;
  humidity?: number | null;
  lastDateUtc?: string;
  dateUtc?: string;
  updatedAtUtc?: string;
  isOnline?: boolean;
  status?: string;
};

type HistoryRow = {
  type?: string;
  teamId?: string;
  serialNumber?: string;
  timeUtc?: string;
  temperature?: number | null;
  humidity?: number | null;
  minTemperature?: number | null;
  maxTemperature?: number | null;
  avgTemperature?: number | null;
  minHumidity?: number | null;
  maxHumidity?: number | null;
  avgHumidity?: number | null;
  count?: number;
};

type PagedResponse<T> = {
  total?: number;
  mode?: string;
  items?: T[];
};

const ARCHIVE_BASE = "/api/admin/reading-archive";
const AGG_BASE = "/api/admin/reading-aggregation";

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toUtcIsoFromLocalInput(value: string): string {
  if (!value) return new Date().toISOString();
  return new Date(value).toISOString();
}

function formatDateTime(value?: string): string {
  if (!value) return "--";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString("vi-VN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatShortDate(value?: string): string {
  if (!value) return "--";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "--";
  return dt.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatNum(value?: number | null, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "--";
  }
  return Number(value).toFixed(digits).replace(/\.00$/, "");
}

function normalizeText(value?: string | number | null): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getLatestTemp(row: LatestRow): number | null | undefined {
  return row.lastTemperature ?? row.temperature;
}

function getLatestHumidity(row: LatestRow): number | null | undefined {
  return row.lastHumidity ?? row.humidity;
}

function getLatestTime(row: LatestRow): string | undefined {
  return row.lastDateUtc ?? row.dateUtc ?? row.updatedAtUtc;
}

function isOnline(row: LatestRow): boolean {
  return row.isOnline ?? normalizeText(row.status) === "online";
}

function getDeviceLabel(row: LatestRow): string {
  return row.deviceName || row.name || row.serialNumber || "Logger";
}

function getHistoryTemp(row: HistoryRow, mode: string): number | null | undefined {
  const isRaw = (row.type ?? mode) === "raw";
  return isRaw ? row.temperature : row.avgTemperature;
}

function getHistoryHum(row: HistoryRow, mode: string): number | null | undefined {
  const isRaw = (row.type ?? mode) === "raw";
  return isRaw ? row.humidity : row.avgHumidity;
}

function getAxiosErrorMessage(ex: any, fallback: string) {
  const status = ex?.response?.status;
  const raw = ex?.response?.data;
  const message =
    raw?.message ||
    (typeof raw === "string" ? raw : undefined) ||
    ex?.message ||
    fallback;

  return status
    ? `HTTP ${status} - ${String(message).slice(0, 260)}`
    : String(message);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || "GET").toUpperCase();
  let body: any = undefined;

  if (init?.body) {
    try {
      body = JSON.parse(String(init.body));
    } catch {
      body = init.body;
    }
  }

  const { data } = await api.request<T>({
    url,
    method,
    data: body,
    headers: {
      Accept: "application/json",
      ...((init?.headers as Record<string, string>) ?? {}),
    },
  });

  return (data ?? {}) as T;
}

function clampPct(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

const ReadingArchivePage: React.FC = () => {
  const now = useMemo(() => new Date(), []);
  const yesterday = useMemo(() => {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return d;
  }, [now]);

  const [teamId, setTeamId] = useState("16922");
  const [serial, setSerial] = useState("");
  const [fromLocal, setFromLocal] = useState(toLocalInputValue(yesterday));
  const [toLocal, setToLocal] = useState(toLocalInputValue(now));
  const [mode, setMode] = useState<DataMode>("auto");

  const [summary, setSummary] = useState<SummaryDto>({});
  const [latestRows, setLatestRows] = useState<LatestRow[]>([]);
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const [historyMode, setHistoryMode] = useState<string>("auto");
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("latest");
  const [latestSearch, setLatestSearch] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("time-desc");

  const summaryUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (teamId.trim()) params.set("teamId", teamId.trim());
    return `${ARCHIVE_BASE}/summary?${params.toString()}`;
  }, [teamId]);

  const latestUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (teamId.trim()) params.set("teamId", teamId.trim());
    if (serial.trim()) params.set("serial", serial.trim());
    params.set("take", "500");
    return `${ARCHIVE_BASE}/latest?${params.toString()}`;
  }, [teamId, serial]);

  const historyUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (teamId.trim()) params.set("teamId", teamId.trim());
    params.set("serial", serial.trim());
    params.set("fromUtc", toUtcIsoFromLocalInput(fromLocal));
    params.set("toUtc", toUtcIsoFromLocalInput(toLocal));
    params.set("mode", mode);
    params.set("limit", "10000");
    return `${ARCHIVE_BASE}/history?${params.toString()}`;
  }, [teamId, serial, fromLocal, toLocal, mode]);

  const loadSummary = useCallback(async () => {
    const data = await fetchJson<SummaryDto>(summaryUrl);
    setSummary(data ?? {});
  }, [summaryUrl]);

  const loadLatest = useCallback(async () => {
    setError(null);
    setOkMessage(null);
    setLoading(true);
    try {
      const data = await fetchJson<PagedResponse<LatestRow>>(latestUrl);
      setLatestRows(data.items ?? []);
      setViewMode("latest");
    } catch (ex: any) {
      setError(getAxiosErrorMessage(ex, "Không tải được latest status."));
    } finally {
      setLoading(false);
    }
  }, [latestUrl]);

  const loadInitial = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      await Promise.all([loadSummary(), loadLatest()]);
    } catch (ex: any) {
      setError(getAxiosErrorMessage(ex, "Không tải được dữ liệu."));
    } finally {
      setLoading(false);
    }
  }, [loadLatest, loadSummary]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const latestStats = useMemo(() => {
    const total = latestRows.length;
    const online = latestRows.filter(isOnline).length;
    const offline = total - online;
    const temps = latestRows
      .map(getLatestTemp)
      .filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    const avgTemp = temps.length
      ? temps.reduce((sum, x) => sum + x, 0) / temps.length
      : null;
    return { total, online, offline, avgTemp };
  }, [latestRows]);

  const archiveTotal = useMemo(() => {
    return (summary.raw ?? 0) + (summary.hourly ?? 0) + (summary.daily ?? 0);
  }, [summary]);

  const latestFiltered = useMemo(() => {
    const keyword = normalizeText(latestSearch);

    return [...latestRows]
      .filter((row) => {
        if (statusFilter === "online") return isOnline(row);
        if (statusFilter === "offline") return !isOnline(row);
        return true;
      })
      .filter((row) => {
        if (!keyword) return true;
        const haystack = [
          row.teamId,
          row.serialNumber,
          row.deviceName,
          row.name,
          row.status,
          formatNum(getLatestTemp(row)),
          formatNum(getLatestHumidity(row)),
        ]
          .map(normalizeText)
          .join(" ");
        return haystack.includes(keyword);
      })
      .sort((a, b) => {
        if (sortKey === "serial-asc") {
          return String(a.serialNumber ?? "").localeCompare(String(b.serialNumber ?? ""));
        }
        if (sortKey === "temp-desc" || sortKey === "temp-asc") {
          const ta = getLatestTemp(a) ?? -999999;
          const tb = getLatestTemp(b) ?? -999999;
          return sortKey === "temp-desc" ? tb - ta : ta - tb;
        }
        const ta = getLatestTime(a) ? new Date(getLatestTime(a)!).getTime() : 0;
        const tb = getLatestTime(b) ? new Date(getLatestTime(b)!).getTime() : 0;
        return sortKey === "time-asc" ? ta - tb : tb - ta;
      });
  }, [latestRows, latestSearch, statusFilter, sortKey]);

  const historyFiltered = useMemo(() => {
    const keyword = normalizeText(historySearch);
    if (!keyword) return historyRows;
    return historyRows.filter((row) => {
      const haystack = [
        row.type,
        row.teamId,
        row.serialNumber,
        row.timeUtc,
        row.count,
        formatNum(getHistoryTemp(row, historyMode)),
        formatNum(getHistoryHum(row, historyMode)),
      ]
        .map(normalizeText)
        .join(" ");
      return haystack.includes(keyword);
    });
  }, [historyRows, historyMode, historySearch]);

  const historyStats = useMemo(() => {
    const temps = historyRows
      .map((row) => getHistoryTemp(row, historyMode))
      .filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    const hums = historyRows
      .map((row) => getHistoryHum(row, historyMode))
      .filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    const countTotal = historyRows.reduce((sum, row) => sum + (row.count ?? 1), 0);
    return {
      rows: historyRows.length,
      countTotal,
      minTemp: temps.length ? Math.min(...temps) : null,
      maxTemp: temps.length ? Math.max(...temps) : null,
      avgHum: hums.length ? hums.reduce((sum, x) => sum + x, 0) / hums.length : null,
    };
  }, [historyRows, historyMode]);

  const handleHistory = async () => {
    if (!serial.trim()) {
      setError("Vui lòng nhập serial trước khi xem lịch sử.");
      return;
    }

    setError(null);
    setOkMessage(null);
    setBusyAction("history");
    try {
      const data = await fetchJson<PagedResponse<HistoryRow>>(historyUrl);
      setHistoryRows(data.items ?? []);
      setHistoryMode(data.mode ?? mode);
      setViewMode("history");
      setOkMessage(`Đã tải ${data.items?.length ?? 0} dòng dữ liệu (${data.mode ?? mode}).`);
    } catch (ex: any) {
      setError(getAxiosErrorMessage(ex, "Không tải được lịch sử dữ liệu."));
    } finally {
      setBusyAction(null);
    }
  };

  const handleAggregateRecent = async () => {
    setError(null);
    setOkMessage(null);
    setBusyAction("aggregate");
    try {
      await fetchJson(`${AGG_BASE}/run-recent`, { method: "POST" });
      setOkMessage("Đã chạy aggregate gần đây thành công.");
      await Promise.all([loadSummary(), loadLatest()]);
    } catch (ex: any) {
      setError(getAxiosErrorMessage(ex, "Chạy aggregate thất bại."));
    } finally {
      setBusyAction(null);
    }
  };

  const handleExport = async () => {
    if (!serial.trim()) {
      setError("Vui lòng nhập serial trước khi export.");
      return;
    }

    setError(null);
    setOkMessage(null);
    setBusyAction("export");

    const params = new URLSearchParams();
    if (teamId.trim()) params.set("teamId", teamId.trim());
    params.set("serial", serial.trim());
    params.set("fromUtc", toUtcIsoFromLocalInput(fromLocal));
    params.set("toUtc", toUtcIsoFromLocalInput(toLocal));
    params.set("mode", mode);

    try {
      const res = await api.get(`${ARCHIVE_BASE}/export?${params.toString()}`, {
        responseType: "blob",
      });

      const contentType = String(res.headers?.["content-type"] || "text/csv;charset=utf-8");
      const blob = new Blob([res.data], { type: contentType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `reading-archive-${serial.trim()}-${mode}-${new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[:T]/g, "")}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setOkMessage("Đã tải file CSV.");
    } catch (ex: any) {
      setError(getAxiosErrorMessage(ex, "Export CSV thất bại."));
    } finally {
      setBusyAction(null);
    }
  };

  const handlePickLatestSerial = (sn?: string) => {
    if (!sn) return;
    setSerial(sn);
    setViewMode("history");
    window.requestAnimationFrame(() => {
      document.querySelector(".rax-filter")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const setRangePreset = (days: number) => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - days);
    setFromLocal(toLocalInputValue(start));
    setToLocal(toLocalInputValue(end));
  };

  const onlinePct = latestStats.total
    ? clampPct((latestStats.online / latestStats.total) * 100)
    : 0;

  return (
    <div className="rax-page">
      <section className="rax-hero">
        <div className="rax-hero__content">
          <div className="rax-kicker">ADMIN · READING ARCHIVE</div>
          <h1>Logger Data Command Center</h1>
          <p>
            Một màn hình để kiểm tra latest status, truy vết raw/hourly/daily và xuất CSV theo khoảng ngày.
          </p>

          <div className="rax-hero__chips" aria-label="Archive status">
            <span className="rax-live-chip"><i /> API qua axios</span>
            <span>{latestStats.online} online</span>
            <span>{formatNum(latestStats.avgTemp, 1)}°C avg latest</span>
          </div>
        </div>

        <div className="rax-hero__panel">
          <div className="rax-orbit">
            <div className="rax-orbit__core">RA</div>
            <span className="dot d1" />
            <span className="dot d2" />
            <span className="dot d3" />
          </div>
          <button
            className="rax-btn rax-btn--hero"
            onClick={handleAggregateRecent}
            disabled={busyAction === "aggregate"}
          >
            {busyAction === "aggregate" ? "Đang aggregate..." : "Chạy aggregate gần đây"}
          </button>
        </div>
      </section>

      {(error || okMessage) && (
        <div className={`rax-toastline ${error ? "is-error" : "is-ok"}`}>
          <span className="rax-toastline__icon">{error ? "!" : "✓"}</span>
          <span>{error || okMessage}</span>
        </div>
      )}

      <section className="rax-metrics" aria-label="Archive metrics">
        <div className="rax-metric-card rax-metric-card--main">
          <div className="rax-metric-card__top">
            <span>Latest status</span>
            <b>{summary.latest ?? latestStats.total ?? 0}</b>
          </div>
          <div className="rax-progress" aria-hidden="true">
            <i style={{ width: `${onlinePct}%` }} />
          </div>
          <small>{latestStats.online} online · {latestStats.offline} offline</small>
        </div>

        <div className="rax-metric-card">
          <span>Raw readings</span>
          <b>{summary.raw ?? "--"}</b>
          <small>Giữ dữ liệu chi tiết gần đây</small>
        </div>

        <div className="rax-metric-card">
          <span>Hourly archive</span>
          <b>{summary.hourly ?? "--"}</b>
          <small>Tối ưu tra cứu trung hạn</small>
        </div>

        <div className="rax-metric-card">
          <span>Daily archive</span>
          <b>{summary.daily ?? "--"}</b>
          <small>Tổng archive: {archiveTotal || "--"}</small>
        </div>
      </section>

      <section className="rax-card rax-filter">
        <div className="rax-card__head">
          <div>
            <span className="rax-section-tag">QUERY BUILDER</span>
            <h2>Bộ lọc dữ liệu</h2>
            <p>Chọn team, serial, thời gian và cấp dữ liệu cần truy xuất.</p>
          </div>

          <div className="rax-head-actions">
            <button className="rax-btn rax-btn--soft" onClick={loadLatest} disabled={loading}>
              {loading ? "Đang tải..." : "Tải latest"}
            </button>
            <button className="rax-btn rax-btn--soft" onClick={loadSummary}>
              Tải summary
            </button>
          </div>
        </div>

        <div className="rax-filter-grid">
          <label className="rax-field">
            <span>Team ID</span>
            <input value={teamId} onChange={(e) => setTeamId(e.target.value)} placeholder="16922" />
          </label>

          <label className="rax-field rax-field--wide">
            <span>Serial / tên thiết bị</span>
            <input
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              placeholder="A0A200..."
              spellCheck={false}
            />
          </label>

          <label className="rax-field">
            <span>Từ ngày</span>
            <input type="datetime-local" value={fromLocal} onChange={(e) => setFromLocal(e.target.value)} />
          </label>

          <label className="rax-field">
            <span>Đến ngày</span>
            <input type="datetime-local" value={toLocal} onChange={(e) => setToLocal(e.target.value)} />
          </label>

          <label className="rax-field">
            <span>Kiểu dữ liệu</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as DataMode)}>
              <option value="auto">Auto</option>
              <option value="raw">Raw</option>
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
            </select>
          </label>
        </div>

        <div className="rax-presets">
          <button type="button" onClick={() => setRangePreset(0)}>Hôm nay</button>
          <button type="button" onClick={() => setRangePreset(1)}>24 giờ</button>
          <button type="button" onClick={() => setRangePreset(7)}>7 ngày</button>
          <button type="button" onClick={() => setRangePreset(30)}>30 ngày</button>
        </div>

        <div className="rax-actions-row">
          <button className="rax-btn rax-btn--primary" onClick={handleHistory} disabled={busyAction === "history"}>
            {busyAction === "history" ? "Đang xem..." : "Xem dữ liệu"}
          </button>
          <button className="rax-btn rax-btn--dark" onClick={handleExport} disabled={busyAction === "export"}>
            {busyAction === "export" ? "Đang export..." : "Export CSV"}
          </button>
        </div>
      </section>

      <section className="rax-card rax-workspace">
        <div className="rax-card__head rax-card__head--compact">
          <div>
            <span className="rax-section-tag">ARCHIVE VIEW</span>
            <h2>{viewMode === "latest" ? "Latest status" : "Lịch sử dữ liệu"}</h2>
            <p>
              {viewMode === "latest"
                ? "Bấm vào serial để đưa vào bộ lọc lịch sử."
                : "Raw dùng cho dữ liệu gần đây, Hourly/Daily dùng cho truy vấn dài hạn."}
            </p>
          </div>

          <div className="rax-view-tabs" role="tablist" aria-label="Chọn bảng dữ liệu">
            <button
              type="button"
              className={viewMode === "latest" ? "is-active" : ""}
              onClick={() => setViewMode("latest")}
            >
              Latest <b>{latestRows.length}</b>
            </button>
            <button
              type="button"
              className={viewMode === "history" ? "is-active" : ""}
              onClick={() => setViewMode("history")}
            >
              History <b>{historyRows.length}</b>
            </button>
          </div>
        </div>

        {viewMode === "latest" ? (
          <>
            <div className="rax-table-tools">
              <input
                value={latestSearch}
                onChange={(e) => setLatestSearch(e.target.value)}
                placeholder="Tìm serial, team, trạng thái, nhiệt độ..."
              />
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
                <option value="all">Tất cả trạng thái</option>
                <option value="online">Online</option>
                <option value="offline">Offline</option>
              </select>
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                <option value="time-desc">Mới nhất trước</option>
                <option value="time-asc">Cũ nhất trước</option>
                <option value="serial-asc">Serial A-Z</option>
                <option value="temp-desc">Nhiệt độ cao trước</option>
                <option value="temp-asc">Nhiệt độ thấp trước</option>
              </select>
            </div>

            <div className="rax-latest-grid">
              {latestFiltered.length === 0 ? (
                <div className="rax-empty">Chưa có dữ liệu latest phù hợp.</div>
              ) : (
                latestFiltered.map((row, idx) => {
                  const sn = row.serialNumber ?? "--";
                  const online = isOnline(row);
                  const temp = getLatestTemp(row);
                  const hum = getLatestHumidity(row);
                  return (
                    <button
                      type="button"
                      key={`${sn}-${idx}`}
                      className={`rax-logger-card ${online ? "is-online" : "is-offline"}`}
                      onClick={() => handlePickLatestSerial(sn)}
                      title="Bấm để chọn serial này"
                    >
                      <span className="rax-logger-card__status">{online ? "Online" : "Offline"}</span>
                      <strong>{sn}</strong>
                      <em>{getDeviceLabel(row)}</em>
                      <div className="rax-logger-card__metrics">
                        <span><b>{formatNum(temp)}</b>°C</span>
                        <span><b>{formatNum(hum)}</b>%RH</span>
                      </div>
                      <small>{formatDateTime(getLatestTime(row))}</small>
                    </button>
                  );
                })
              )}
            </div>
          </>
        ) : (
          <>
            <div className="rax-history-insights">
              <div><span>Dòng hiển thị</span><b>{historyFiltered.length}</b></div>
              <div><span>Tổng điểm đo</span><b>{historyStats.countTotal}</b></div>
              <div><span>Nhiệt độ min/max</span><b>{formatNum(historyStats.minTemp)} / {formatNum(historyStats.maxTemp)}</b></div>
              <div><span>Độ ẩm TB</span><b>{formatNum(historyStats.avgHum)}%</b></div>
              <div><span>Mode</span><b>{historyMode}</b></div>
            </div>

            <div className="rax-table-tools">
              <input
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Tìm trong dữ liệu lịch sử..."
              />
              <span className="rax-result-pill">
                Serial: {serial.trim() || "chưa chọn"} · {formatShortDate(toUtcIsoFromLocalInput(fromLocal))} → {formatShortDate(toUtcIsoFromLocalInput(toLocal))}
              </span>
            </div>

            <div className="rax-table-wrap">
              <table className="rax-table">
                <thead>
                  <tr>
                    <th>Bucket</th>
                    <th>Serial</th>
                    <th>Count</th>
                    <th>Min</th>
                    <th>Max</th>
                    <th>Avg</th>
                    <th>Humidity Avg</th>
                  </tr>
                </thead>
                <tbody>
                  {historyFiltered.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="rax-empty-cell">
                        Chưa có dữ liệu lịch sử.
                      </td>
                    </tr>
                  ) : (
                    historyFiltered.map((row, idx) => {
                      const isRaw = (row.type ?? historyMode) === "raw";
                      return (
                        <tr key={`${row.serialNumber ?? "row"}-${row.timeUtc ?? idx}`}>
                          <td>{formatDateTime(row.timeUtc)}</td>
                          <td>{row.serialNumber ?? "--"}</td>
                          <td>{row.count ?? 1}</td>
                          <td>{isRaw ? formatNum(row.temperature) : formatNum(row.minTemperature)}</td>
                          <td>{isRaw ? formatNum(row.temperature) : formatNum(row.maxTemperature)}</td>
                          <td>{isRaw ? formatNum(row.temperature) : formatNum(row.avgTemperature)}</td>
                          <td>{isRaw ? formatNum(row.humidity) : formatNum(row.avgHumidity)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
};

export default ReadingArchivePage;
