import React, { useEffect, useRef, useState, useMemo } from "react";
import "../../styles/Admin/ProfilesPage.css";
import api from "../../api/axios";
import type { ProfilesEnvelope, TeamProfile } from "../../api/logtag";
import { ChevronDown, RefreshCw, Search, AlertTriangle, Thermometer, Timer, Cpu } from "lucide-react";

const PROFILES_TIMEOUT_MS = 12_000;

const ProfilesPage: React.FC = () => {
  const [profiles, setProfiles] = useState<TeamProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null); // chỉ 1 card mở

  const inflightCtrlRef = useRef<AbortController | null>(null);
  const reqIdRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = async (teamId: number) => {
    inflightCtrlRef.current?.abort();
    if (timerRef.current) clearTimeout(timerRef.current);

    const ctrl = new AbortController();
    inflightCtrlRef.current = ctrl;
    const myReqId = ++reqIdRef.current;

    setLoading(true);
    setError(null);

    timerRef.current = setTimeout(() => {
      if (!ctrl.signal.aborted) {
        ctrl.abort();
        if (myReqId === reqIdRef.current) setError(`Timeout (${PROFILES_TIMEOUT_MS / 1000}s). Vui lòng thử lại.`);
        if (myReqId === reqIdRef.current) setLoading(false);
      }
    }, PROFILES_TIMEOUT_MS);

    try {
      const res = await api.get<ProfilesEnvelope>(`/api/external/profiles/v1/${teamId}`, { signal: ctrl.signal });
      if (myReqId === reqIdRef.current) setProfiles(res.data?.data || []);
    } catch (err: any) {
      if (err?.code === "ERR_CANCELED") return;
      const status = err?.response?.status;
      if (status === 429) {
        const ra = Number(err?.response?.headers?.["retry-after"]) || err?.response?.data?.retryAfterSeconds || 5;
        if (myReqId === reqIdRef.current) setError(`Hệ thống đang giới hạn tần suất. Thử lại sau ~${ra}s.`);
      } else {
        const msg = err?.response?.data?.message || err?.message || "Lỗi khi tải profiles";
        if (myReqId === reqIdRef.current) setError(`HTTP ${status ?? "?"} – ${msg}`);
      }
    } finally {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (myReqId === reqIdRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    const stored = localStorage.getItem("teamId");
    const teamId = stored ? Number(stored) : 16922;
    void load(teamId);
    return () => {
      inflightCtrlRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleRetry = () => {
    const stored = localStorage.getItem("teamId");
    const teamId = stored ? Number(stored) : 16922;
    void load(teamId);
  };

  const filtered = useMemo(() => {
    if (!query.trim()) return profiles;
    const q = query.toLowerCase();
    return profiles.filter((p) => p.name?.toLowerCase().includes(q) || p.model?.toLowerCase().includes(q));
  }, [profiles, query]);

  const typeClass = (name?: string | null) => {
    const n = (name || "").toLowerCase();
    if (n.includes("ambient")) return "ambient";
    if (n.includes("freezer")) return "freezer";
    if (n.includes("fridge") || n.includes("refrigerator")) return "fridge";
    return "default";
  };

  const onToggle = (id: number) => setExpanded((cur) => (cur === id ? null : id));

  return (
    <div className="profiles-page">
      <div className="profiles-header">
        <div className="title-wrap">
          <h2 className="profiles-title">📋 Profiles</h2>
          <p className="profiles-sub">Cấu hình ghi nhiệt/ẩm theo từng profile</p>
        </div>

        <div className="actions">
          <div className="search">
            <Search size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm theo tên/model…"
              aria-label="Tìm kiếm profiles"
            />
          </div>
          <button className="btn" onClick={handleRetry} aria-label="Tải lại">
            <RefreshCw size={16} /> <span className="hide-sm">Tải lại</span>
          </button>
        </div>
      </div>

      {loading && (
        <div className="profiles-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="profile-card skeleton" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="profiles-error">
          ❌ {error}{" "}
          <button className="profiles-retry-btn" onClick={handleRetry}>
            Thử lại
          </button>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="empty">Không có profile nào phù hợp <b>"{query}"</b>.</div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="profiles-grid">
          {filtered.map((p) => {
            const tClass = typeClass(p.name);
            const opened = expanded === p.id;
            return (
              <div key={p.id} className={`profile-card ${tClass} ${opened ? "open" : ""}`}>
                <button
                  className="profile-head"
                  onClick={() => onToggle(p.id)}
                  aria-expanded={opened}
                  aria-controls={`profile-${p.id}-details`}
                >
                  <div className="head-left">
                    <span className={`dot ${tClass}`} />
                    {/* Hiển thị FULL tên + tooltip */}
                    <h3 className="profile-name" title={p.name}>{p.name}</h3>
                    {p.alarmIndicatorEnabled && (
                      <span className="badge warn" title="Alarm indicator enabled">
                        <AlertTriangle size={14} /> Alarm
                      </span>
                    )}
                  </div>

                  <div className="head-right">
                    <span className="pill" title={`Model ${p.model}`}>
                      <Cpu size={14} /> {p.model}
                    </span>
                    <span className="pill" title={`Interval ${p.recordingIntervalInSeconds}s`}>
                      <Timer size={14} /> {p.recordingIntervalInSeconds}s
                    </span>
                    <span className="pill" title={`${p.alarms?.length ?? 0} alarms`}>
                      <Thermometer size={14} /> {p.alarms?.length ?? 0} alarms
                    </span>
                    <ChevronDown className="chev" size={18} />
                  </div>
                </button>

                <div id={`profile-${p.id}-details`} className="profile-details" aria-hidden={!opened}>
                  <div className="kv">
                    <div><b>Allow Stop:</b> {p.allowLoggingStop ? "Có" : "Không"}</div>
                    <div><b>Start Delay:</b> {p.startDelayInSeconds}s</div>
                    <div><b>Alarm Indicator:</b> {p.alarmIndicatorEnabled ? "Bật" : "Tắt"}</div>
                  </div>

                  <h4 className="sec-title">🚨 Alarms</h4>
                  {p.alarms?.length ? (
                    <ul className="alarms">
                      {p.alarms.map((a, idx) => (
                        <li key={idx} className={a.isUpper ? "upper" : "lower"}>
                          <span className="tag">{a.sensor}</span>
                          <span className="sep">•</span>
                          <span>{a.isUpper ? "Upper" : "Lower"}</span>
                          <span className="sep">•</span>
                          <span>Threshold: <b>{a.thresholdValue ?? "N/A"}</b></span>
                          <span className="sep">•</span>
                          <span>Readings: {a.numberOfReadingsBeforeAlert}</span>
                          <span className="sep">•</span>
                          <span>Trigger: {a.alarmTriggerType}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">Không có alarms.</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ProfilesPage;
