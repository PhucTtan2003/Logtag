import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  BellRing,
  CheckCircle2,
  ChevronRight,
  Clock3,
  CloudDownload,
  Copy,
  Database,
  Loader2,
  RefreshCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  TimerReset,
  X,
} from "lucide-react";
import api from "../../api/axios";
import Toast from "../../components/Toast";
import "../../styles/Ltgeo/Lt5ProfilesPage.css";

type Lt5Alarm = {
  sensor?: string | null;
  isUpper: boolean;
  thresholdValue?: number | null;
  alarmTriggerType?: string | null;
  numberOfReadingsBeforeAlert?: number | null;
};

type Lt5Profile = {
  id?: string | null;
  teamId?: number;
  profileId: number;
  name?: string | null;
  model?: string | null;
  recordingIntervalInSeconds: number;
  startDelayInSeconds: number;
  alarmIndicatorEnabled: boolean;
  allowLoggingStop: boolean;
  alarms?: Lt5Alarm[];
  updatedAtUtc?: string | null;
  isDeleted?: boolean;
};

type ProfilesListResponse = {
  data: Lt5Profile[];
};

type ProfileFilter = "all" | "withAlarms" | "noAlarms" | "fast" | "deleted";
type SortKey = "name" | "profileId" | "model" | "interval";

const fmtMins = (sec?: number | null) => {
  const s = Number(sec || 0);
  if (s <= 0) return "0s";
  if (s < 60) return `${s}s`;

  const mins = Math.round(s / 60);
  if (mins < 60) return `${mins} phút`;

  const hours = Math.floor(mins / 60);
  const remain = mins % 60;
  return remain ? `${hours} giờ ${remain} phút` : `${hours} giờ`;
};

const fmtDateTime = (input?: string | null) => {
  if (!input) return "—";
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("vi-VN", { hour12: false });
};

const stripVi = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const profileName = (profile?: Lt5Profile | null) => profile?.name?.trim() || "Không có tên";
const profileModel = (profile?: Lt5Profile | null) => profile?.model?.trim() || "N/A";

const useIsMobile = (bp = 900) => {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= bp : false
  );

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= bp);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [bp]);

  return isMobile;
};

const alarmTone = (alarm: Lt5Alarm) => {
  const sensor = stripVi(alarm.sensor);
  if (sensor.includes("humid")) return "humidity";
  if (sensor.includes("lux") || sensor.includes("light")) return "lux";
  if (sensor.includes("shock")) return "shock";
  return "temperature";
};

const alarmLabel = (alarm: Lt5Alarm) => {
  const sensor = alarm.sensor || "Sensor";
  const direction = alarm.isUpper ? "vượt ngưỡng cao" : "dưới ngưỡng thấp";
  const value = alarm.thresholdValue ?? "—";
  return `${sensor} ${direction}: ${value}`;
};

export default function Lt5ProfilesPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile(900);

  const [profiles, setProfiles] = useState<Lt5Profile[]>([]);
  const [selected, setSelected] = useState<Lt5Profile | null>(null);
  const [screen, setScreen] = useState<"list" | "detail">("list");

  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<ProfileFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");

  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  useEffect(() => {
    if (!isMobile) setScreen("list");
  }, [isMobile]);

  const fetchProfiles = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get<ProfilesListResponse>("/api/lt5/profiles");
      const items = Array.isArray(res.data?.data) ? res.data.data : [];

      setProfiles(items);
      setSelected((prev) => {
        const stillSelected = prev ? items.find((x) => x.profileId === prev.profileId) ?? null : null;
        if (stillSelected) return stillSelected;
        return !isMobile ? items[0] ?? null : null;
      });

      if (isMobile) setScreen("list");
    } catch (err: any) {
      setProfiles([]);
      setSelected(null);
      setToast({
        message: err?.response?.data?.message || `Không tải được profiles: ${err?.message || "Unknown"}`,
        type: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [isMobile]);

  const syncProfiles = async () => {
    try {
      setSyncing(true);
      const res = await api.post("/api/lt5/profiles/sync");
      const msg =
        res.data?.message ||
        `Sync thành công${typeof res.data?.synced === "number" ? ` • ${res.data.synced} profile` : ""}${
          typeof res.data?.deleted === "number" ? ` • ${res.data.deleted} đã xoá` : ""
        }`;

      setToast({ message: msg, type: "success" });
      await fetchProfiles();
    } catch (err: any) {
      setToast({
        message: err?.response?.data?.message || `Sync thất bại: ${err?.message || "Unknown"}`,
        type: "error",
      });
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    void fetchProfiles();
  }, [fetchProfiles]);

  const stats = useMemo(() => {
    const total = profiles.length;
    const withAlarms = profiles.filter((p) => (p.alarms?.length ?? 0) > 0).length;
    const modelCount = new Set(profiles.map((p) => profileModel(p)).filter((m) => m !== "N/A")).size;
    const fast = profiles.filter((p) => Number(p.recordingIntervalInSeconds || 0) <= 300).length;
    const deleted = profiles.filter((p) => p.isDeleted).length;

    return { total, withAlarms, modelCount, fast, deleted };
  }, [profiles]);

  const filtered = useMemo(() => {
    const keyword = stripVi(q);

    return profiles
      .filter((p) => {
        if (filter === "withAlarms") return (p.alarms?.length ?? 0) > 0;
        if (filter === "noAlarms") return (p.alarms?.length ?? 0) === 0;
        if (filter === "fast") return Number(p.recordingIntervalInSeconds || 0) <= 300;
        if (filter === "deleted") return !!p.isDeleted;
        return true;
      })
      .filter((p) => {
        if (!keyword) return true;
        const haystack = stripVi(
          `${p.profileId} ${p.name || ""} ${p.model || ""} ${p.teamId || ""} ${p.alarms
            ?.map((a) => `${a.sensor || ""} ${a.thresholdValue || ""}`)
            .join(" ")}`
        );
        return haystack.includes(keyword);
      })
      .sort((a, b) => {
        if (sortKey === "profileId") return Number(a.profileId || 0) - Number(b.profileId || 0);
        if (sortKey === "model") return profileModel(a).localeCompare(profileModel(b), "vi");
        if (sortKey === "interval") return Number(a.recordingIntervalInSeconds || 0) - Number(b.recordingIntervalInSeconds || 0);
        return profileName(a).localeCompare(profileName(b), "vi");
      });
  }, [profiles, q, filter, sortKey]);

  const filterTabs: Array<{ key: ProfileFilter; label: string; count: number }> = [
    { key: "all", label: "Tất cả", count: profiles.length },
    { key: "withAlarms", label: "Có alarm", count: stats.withAlarms },
    { key: "noAlarms", label: "Không alarm", count: profiles.length - stats.withAlarms },
    { key: "fast", label: "Lấy mẫu nhanh", count: stats.fast },
    { key: "deleted", label: "Đã xoá", count: stats.deleted },
  ];

  const handleSelect = (profile: Lt5Profile) => {
    setSelected(profile);
    if (isMobile) setScreen("detail");
  };

  const copyProfileId = async (profileId?: number) => {
    if (!profileId) return;
    try {
      await navigator.clipboard.writeText(String(profileId));
      setToast({ message: `Đã copy loggerProfileId #${profileId}`, type: "success" });
    } catch {
      setToast({ message: "Không copy được profile id.", type: "error" });
    }
  };

  return (
    <div className="lt5p-page">
      <div className="lt5p-aura" />

      <header className="lt5p-hero">
        <div className="lt5p-hero-main">
          <button className="lt5p-back" type="button" onClick={() => navigate("/admin")}>
            <ArrowLeft size={16} />
            <span>Admin</span>
          </button>

          <div>
            <div className="lt5p-kicker">
              <Database size={15} /> LT5 PROFILE COMMAND CENTER
            </div>
            <h1>Quản lý LT5 Profiles</h1>
            <p>
              Đồng bộ profile từ LogTag Online, chọn cấu hình phù hợp và kiểm tra alarm trước khi vận hành shipment.
            </p>
          </div>
        </div>

        <div className="lt5p-hero-actions">
          <button className="lt5p-btn lt5p-btn-ghost" type="button" onClick={fetchProfiles} disabled={loading || syncing}>
            {loading ? <Loader2 className="lt5p-spin" size={16} /> : <RefreshCcw size={16} />}
            Reload
          </button>
          <button className="lt5p-btn lt5p-btn-primary" type="button" onClick={syncProfiles} disabled={loading || syncing}>
            {syncing ? <Loader2 className="lt5p-spin" size={16} /> : <CloudDownload size={16} />}
            Sync LogTag
          </button>
        </div>
      </header>

      <section className="lt5p-stats" aria-label="Thống kê profile">
        <div className="lt5p-stat-card">
          <span>Tổng profiles</span>
          <strong>{stats.total}</strong>
          <small>Đang lưu trong hệ thống</small>
        </div>
        <div className="lt5p-stat-card cyan">
          <span>Model</span>
          <strong>{stats.modelCount}</strong>
          <small>Loại thiết bị khác nhau</small>
        </div>
        <div className="lt5p-stat-card amber">
          <span>Có alarm</span>
          <strong>{stats.withAlarms}</strong>
          <small>Profile có ngưỡng cảnh báo</small>
        </div>
        <div className="lt5p-stat-card violet">
          <span>Lấy mẫu nhanh</span>
          <strong>{stats.fast}</strong>
          <small>Interval ≤ 5 phút</small>
        </div>
      </section>

      <section className="lt5p-console">
        <div className="lt5p-toolbar">
          <div className="lt5p-search">
            <Search size={17} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm theo tên, model, profileId, teamId, sensor..."
            />
            {q && (
              <button type="button" onClick={() => setQ("")} aria-label="Xoá tìm kiếm">
                <X size={14} />
              </button>
            )}
          </div>

          <label className="lt5p-sort">
            <SlidersHorizontal size={15} />
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} aria-label="Sắp xếp">
              <option value="name">Tên A-Z</option>
              <option value="profileId">Profile ID</option>
              <option value="model">Model</option>
              <option value="interval">Interval nhanh trước</option>
            </select>
          </label>
        </div>

        <div className="lt5p-tabs" role="tablist" aria-label="Lọc profiles">
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`lt5p-tab ${filter === tab.key ? "active" : ""}`}
              onClick={() => setFilter(tab.key)}
            >
              <span>{tab.label}</span>
              <b>{tab.count}</b>
            </button>
          ))}
        </div>

        <div className={`lt5p-workspace ${isMobile ? `is-mobile screen-${screen}` : ""}`}>
          <aside className="lt5p-list-panel">
            <div className="lt5p-panel-head">
              <div>
                <h2>Profile Explorer</h2>
                <p>{filtered.length} / {profiles.length} profile phù hợp</p>
              </div>
              {loading && <Loader2 className="lt5p-spin" size={18} />}
            </div>

            <div className="lt5p-list">
              {!loading && filtered.length === 0 && (
                <div className="lt5p-empty">
                  <Search size={24} />
                  <b>Không có profile phù hợp</b>
                  <span>Thử đổi bộ lọc hoặc bấm Sync LogTag.</span>
                </div>
              )}

              {loading && profiles.length === 0
                ? Array.from({ length: 6 }).map((_, idx) => <div className="lt5p-skeleton" key={idx} />)
                : filtered.map((p) => {
                    const active = selected?.profileId === p.profileId;
                    const alarmCount = p.alarms?.length ?? 0;

                    return (
                      <button
                        key={`${p.profileId}-${p.teamId ?? "team"}`}
                        type="button"
                        className={`lt5p-profile-row ${active ? "active" : ""} ${p.isDeleted ? "deleted" : ""}`}
                        onClick={() => handleSelect(p)}
                      >
                        <div className="lt5p-row-icon">
                          {alarmCount > 0 ? <BellRing size={18} /> : <ShieldCheck size={18} />}
                        </div>

                        <div className="lt5p-row-main">
                          <div className="lt5p-row-top">
                            <strong>{profileName(p)}</strong>
                            <span>#{p.profileId}</span>
                          </div>

                          <div className="lt5p-row-model">Model: {profileModel(p)}</div>

                          <div className="lt5p-row-chips">
                            <span>
                              <Clock3 size={12} /> {fmtMins(p.recordingIntervalInSeconds)}
                            </span>
                            <span>
                              <TimerReset size={12} /> {fmtMins(p.startDelayInSeconds)}
                            </span>
                            {alarmCount > 0 && <span className="warn">{alarmCount} alarm</span>}
                          </div>
                        </div>

                        <ChevronRight className="lt5p-row-chevron" size={18} />
                      </button>
                    );
                  })}
            </div>
          </aside>

          <main className="lt5p-detail-panel">
            {isMobile && screen === "detail" && (
              <div className="lt5p-mobile-detailbar">
                <button className="lt5p-btn lt5p-btn-ghost" type="button" onClick={() => setScreen("list")}>
                  <ArrowLeft size={15} /> Danh sách
                </button>
                <strong>{selected ? profileName(selected) : "Profile detail"}</strong>
              </div>
            )}

            {!selected ? (
              <div className="lt5p-detail-empty">
                <ShieldCheck size={42} />
                <h2>Chọn một profile để xem cấu hình</h2>
                <p>
                  Khu vực này hiển thị interval, delay, alarm và loggerProfileId để đội vận hành chọn đúng profile.
                </p>
              </div>
            ) : (
              <div className="lt5p-detail-content">
                <div className="lt5p-detail-head">
                  <div>
                    <div className="lt5p-kicker small">PROFILE SPOTLIGHT</div>
                    <h2>{profileName(selected)}</h2>
                    <p>
                      Model {profileModel(selected)} • Profile ID #{selected.profileId}
                    </p>
                  </div>

                  <button className="lt5p-copy" type="button" onClick={() => copyProfileId(selected.profileId)}>
                    <Copy size={15} /> Copy ID
                  </button>
                </div>

                <div className="lt5p-id-card">
                  <span>loggerProfileId</span>
                  <strong>{selected.profileId}</strong>
                  <small>Dùng ID này khi gán profile cho logger / shipment.</small>
                </div>

                <div className="lt5p-detail-grid">
                  <div className="lt5p-mini-card">
                    <Clock3 size={18} />
                    <span>Recording interval</span>
                    <strong>{fmtMins(selected.recordingIntervalInSeconds)}</strong>
                  </div>
                  <div className="lt5p-mini-card">
                    <TimerReset size={18} />
                    <span>Start delay</span>
                    <strong>{fmtMins(selected.startDelayInSeconds)}</strong>
                  </div>
                  <div className="lt5p-mini-card">
                    <BellRing size={18} />
                    <span>Alarm LED</span>
                    <strong>{selected.alarmIndicatorEnabled ? "Bật" : "Tắt"}</strong>
                  </div>
                  <div className="lt5p-mini-card">
                    <ShieldCheck size={18} />
                    <span>Stop log</span>
                    <strong>{selected.allowLoggingStop ? "Cho phép" : "Chặn"}</strong>
                  </div>
                </div>

                <section className="lt5p-alarm-section">
                  <div className="lt5p-section-head">
                    <h3>Alarm rules</h3>
                    <span>{selected.alarms?.length ?? 0} rule</span>
                  </div>

                  {selected.alarms && selected.alarms.length > 0 ? (
                    <div className="lt5p-alarm-grid">
                      {selected.alarms.map((alarm, idx) => (
                        <div className={`lt5p-alarm-card ${alarmTone(alarm)}`} key={`${alarm.sensor}-${idx}`}>
                          <div className="lt5p-alarm-top">
                            <AlertTriangle size={17} />
                            <strong>{alarm.sensor || "Sensor"}</strong>
                          </div>
                          <p>{alarmLabel(alarm)}</p>
                          <div className="lt5p-alarm-meta">
                            <span>{alarm.alarmTriggerType || "Trigger N/A"}</span>
                            <span>{alarm.numberOfReadingsBeforeAlert ?? "—"} readings</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="lt5p-safe-box">
                      <CheckCircle2 size={20} />
                      <div>
                        <strong>Profile này chưa có alarm rule.</strong>
                        <span>Phù hợp khi chỉ cần ghi nhận dữ liệu, chưa cần cảnh báo ngưỡng.</span>
                      </div>
                    </div>
                  )}
                </section>

                <section className="lt5p-info-strip">
                  <div>
                    <span>Team ID</span>
                    <strong>{selected.teamId ?? "—"}</strong>
                  </div>
                  <div>
                    <span>Cập nhật</span>
                    <strong>{fmtDateTime(selected.updatedAtUtc)}</strong>
                  </div>
                  <div>
                    <span>Trạng thái</span>
                    <strong className={selected.isDeleted ? "danger" : "ok"}>
                      {selected.isDeleted ? "Đã xoá trên LogTag" : "Sẵn sàng"}
                    </strong>
                  </div>
                </section>

                <div className="lt5p-callout">
                  <CloudDownload size={18} />
                  <div>
                    <strong>Gợi ý vận hành:</strong> Nếu profile đã xoá trên LogTag Online nhưng vẫn còn hiển thị, bấm
                    <b> Sync LogTag</b> để cập nhật dữ liệu DB trước khi cấp cho shipment mới.
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>
      </section>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
          durationMs={toast.type === "success" ? 1800 : 3200}
        />
      )}
    </div>
  );
}
