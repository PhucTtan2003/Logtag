import React, { useEffect, useMemo, useState } from "react";
import api from "../../api/axios";
import Toast from "../../components/Toast";
import "../../styles/Ltgeo/CreateShipmentLt5Page.css";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Cpu,
  Info,
  Loader2,
  PackagePlus,
  Plus,
  RefreshCcw,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

type Lt5Alarm = {
  sensor?: string | null;
  isUpper: boolean;
  thresholdValue?: number | null;
  alarmTriggerType?: string | null;
  numberOfReadingsBeforeAlert?: number | null;
};

type Lt5Profile = {
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
};

type ProfilesListResponse = {
  data: Lt5Profile[];
  status?: string;
  timestampUtc?: string;
};

type ShipmentCreateResp = {
  status?: string;
  timestampUtc?: string;
  data?: {
    shipmentId?: number;
    shipmentName?: string | null;
    shipmentState?: string | null;
  };
};

type DeviceRow = {
  serialNumber: string;
};

type ToastState = {
  message: string;
  type: "success" | "error" | "info";
};

const transmissionOptions = [20, 60, 120, 180, 240, 360, 480, 600, 720, 1080, 1440];

const fmtMins = (sec: number) => {
  const s = Number(sec || 0);
  if (s <= 0) return "0 phút";
  const mins = Math.round(s / 60);
  if (mins < 60) return `${mins} phút`;

  const hours = Math.floor(mins / 60);
  const remain = mins % 60;
  return remain ? `${hours} giờ ${remain} phút` : `${hours} giờ`;
};

const fmtTx = (mins: number) => {
  if (mins < 60) return `${mins} phút`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} giờ ${m} phút` : `${h} giờ`;
};

const sensorLabel = (s?: string | null) => {
  const k = String(s || "").toLowerCase();
  if (k.includes("temp")) return "Temperature";
  if (k.includes("humi")) return "Humidity";
  if (k.includes("lux")) return "Lux";
  if (k.includes("shock")) return "Shock";
  return s || "N/A";
};

const triggerLabel = (s?: string | null) => {
  const k = String(s || "").toLowerCase();
  if (k.includes("instant")) return "Instant";
  if (k.includes("consecutive")) return "Consecutive";
  if (k.includes("accumulative")) return "Accumulative";
  return s || "N/A";
};

const boundLabel = (isUpper: boolean) => (isUpper ? "Upper" : "Lower");

const normSerial = (s: string) =>
  String(s || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

const normalizeText = (s?: string | number | null) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const toUtcIsoOrNull = (localDatetime: string): string | null => {
  const s = (localDatetime || "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
};

const toLocalInput = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
};

const pickProfiles = (raw: any): Lt5Profile[] => {
  const src = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.data)
    ? raw.data
    : Array.isArray(raw?.items)
    ? raw.items
    : [];

  return src
    .map((x: any) => ({
      teamId: Number.isFinite(Number(x.teamId)) ? Number(x.teamId) : undefined,
      profileId: Number(x.profileId ?? x.loggerProfileId ?? x.id),
      name: x.name ?? x.profileName ?? null,
      model: x.model ?? null,
      recordingIntervalInSeconds: Number(x.recordingIntervalInSeconds ?? x.intervalSeconds ?? 0),
      startDelayInSeconds: Number(x.startDelayInSeconds ?? 0),
      alarmIndicatorEnabled: Boolean(x.alarmIndicatorEnabled),
      allowLoggingStop: Boolean(x.allowLoggingStop),
      alarms: Array.isArray(x.alarms) ? x.alarms : [],
      updatedAtUtc: x.updatedAtUtc ?? null,
    }))
    .filter((x: Lt5Profile) => Number.isFinite(x.profileId));
};

const profileSearchHaystack = (p: Lt5Profile) =>
  normalizeText([
    p.profileId,
    p.teamId,
    p.name,
    p.model,
    p.recordingIntervalInSeconds,
    ...(p.alarms || []).flatMap((a) => [a.sensor, a.alarmTriggerType, a.thresholdValue]),
  ].join(" "));

export default function CreateShipmentLt5Page() {
  const navigate = useNavigate();

  const [profiles, setProfiles] = useState<Lt5Profile[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Lt5Profile | null>(null);

  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const [profileQuery, setProfileQuery] = useState("");
  const [profileFilter, setProfileFilter] = useState<"all" | "alarm" | "noAlarm" | "fast">("all");

  const [shipmentName, setShipmentName] = useState("");
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");
  const [txMinutes, setTxMinutes] = useState<number>(60);
  const [devices, setDevices] = useState<DeviceRow[]>([{ serialNumber: "" }]);
  const [submitting, setSubmitting] = useState(false);

  const selectedFromList = useMemo(
    () => profiles.find((x) => x.profileId === selectedId) || null,
    [profiles, selectedId]
  );

  const selected = detail || selectedFromList;
  const alarms = selected?.alarms || [];

  const profileStats = useMemo(() => {
    const total = profiles.length;
    const withAlarm = profiles.filter((x) => (x.alarms || []).length > 0).length;
    const fast = profiles.filter((x) => Number(x.recordingIntervalInSeconds || 0) <= 600).length;
    const models = new Set(profiles.map((x) => x.model).filter(Boolean)).size;
    return { total, withAlarm, fast, models };
  }, [profiles]);

  const serials = useMemo(
    () => devices.map((d) => normSerial(d.serialNumber)).filter(Boolean),
    [devices]
  );

  const duplicateSerials = useMemo(() => {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const s of serials) {
      if (seen.has(s)) dup.add(s);
      seen.add(s);
    }
    return dup;
  }, [serials]);

  const filteredProfiles = useMemo(() => {
    const keyword = normalizeText(profileQuery);

    return profiles.filter((p) => {
      if (profileFilter === "alarm" && !(p.alarms || []).length) return false;
      if (profileFilter === "noAlarm" && (p.alarms || []).length > 0) return false;
      if (profileFilter === "fast" && Number(p.recordingIntervalInSeconds || 0) > 600) return false;
      if (!keyword) return true;
      return profileSearchHaystack(p).includes(keyword);
    });
  }, [profiles, profileQuery, profileFilter]);

  const selectedProfileName = selected?.name?.trim() || "Profile chưa đặt tên";
  const canCreate = !!selected && !submitting;

  const fetchProfiles = async () => {
    try {
      setLoadingList(true);
      const res = await api.get<ProfilesListResponse>("/api/lt5/profiles");
      const items = pickProfiles(res.data);

      setProfiles(items);

      const stillExists = selectedId && items.some((x) => x.profileId === selectedId);
      const next = stillExists ? selectedId : items[0]?.profileId ?? null;

      setSelectedId(next);
      setDetail(null);
      setToast({ message: `Đã tải ${items.length} profiles`, type: "success" });
    } catch (err: any) {
      setProfiles([]);
      setSelectedId(null);
      setDetail(null);
      setToast({
        message: err?.response?.data?.message || `Load profiles thất bại: ${err?.message || "Unknown error"}`,
        type: "error",
      });
    } finally {
      setLoadingList(false);
    }
  };

  const fetchDetailIfNeeded = async (profileId: number) => {
    const inList = profiles.find((x) => x.profileId === profileId);
    if (inList?.alarms && inList.alarms.length > 0) {
      setDetail(null);
      return;
    }

    try {
      setLoadingDetail(true);
      const res = await api.get<Lt5Profile | { data?: Lt5Profile }>(`/api/lt5/profiles/${profileId}`);
      const next = (res.data as any)?.data ?? res.data ?? null;
      setDetail(next as Lt5Profile | null);
    } catch (err: any) {
      setDetail(null);
      setToast({
        message: err?.response?.data?.message || `Load detail thất bại: ${err?.message || "Unknown error"}`,
        type: "error",
      });
    } finally {
      setLoadingDetail(false);
    }
  };

  useEffect(() => {
    void fetchProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void fetchDetailIfNeeded(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const addDeviceRow = () => {
    setDevices((prev) => {
      if (prev.length >= 5) {
        setToast({ message: "Tối đa 5 devices cho mỗi shipment.", type: "info" });
        return prev;
      }
      return [...prev, { serialNumber: "" }];
    });
  };

  const removeDeviceRow = (idx: number) => {
    setDevices((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateDeviceRow = (idx: number, serialNumber: string) => {
    setDevices((prev) => prev.map((d, i) => (i === idx ? { ...d, serialNumber } : d)));
  };

  const setStartPreset = (mode: "now" | "plus1h" | "tomorrow") => {
    const d = new Date();
    if (mode === "plus1h") d.setHours(d.getHours() + 1);
    if (mode === "tomorrow") d.setDate(d.getDate() + 1);
    setStartLocal(toLocalInput(d));
  };

  const copyProfileId = async () => {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(String(selected.profileId));
      setToast({ message: `Đã copy profileId ${selected.profileId}`, type: "success" });
    } catch {
      setToast({ message: `profileId = ${selected.profileId}`, type: "info" });
    }
  };

  const validateCreate = (): string | null => {
    if (!selected) return "Chưa chọn profile.";
    if (devices.length === 0) return "Cần ít nhất 1 serial.";
    if (devices.length > 5) return "Tối đa 5 devices/shipment.";

    const cleanSerials = devices.map((d) => normSerial(d.serialNumber));
    if (cleanSerials.some((x) => !x)) return "Có serial đang trống.";

    const dup = cleanSerials.find((s, i) => cleanSerials.indexOf(s) !== i);
    if (dup) return `Serial bị trùng: ${dup}`;

    const startUtc = toUtcIsoOrNull(startLocal);
    if (!startUtc) return "Start time là bắt buộc.";

    const endUtc = toUtcIsoOrNull(endLocal);
    if (endLocal && !endUtc) return "End time không hợp lệ.";

    if (endUtc) {
      const a = new Date(startUtc).getTime();
      const b = new Date(endUtc).getTime();
      if (!Number.isNaN(a) && !Number.isNaN(b) && b <= a) return "End phải lớn hơn Start.";
    }

    if (!transmissionOptions.includes(txMinutes)) return "Transmission interval không hợp lệ.";
    return null;
  };

  const submitCreateShipment = async (e?: React.FormEvent) => {
    e?.preventDefault();

    const err = validateCreate();
    if (err) {
      setToast({ message: err, type: "error" });
      return;
    }

    const payload = {
      shipmentName: shipmentName.trim() || null,
      startDateUtc: toUtcIsoOrNull(startLocal),
      endDateUtc: toUtcIsoOrNull(endLocal) || null,
      transmissionIntervalMinutes: txMinutes,
      devices: devices.map((d) => ({
        serialNumber: normSerial(d.serialNumber),
        loggerProfileId: selected!.profileId,
      })),
    };

    try {
      setSubmitting(true);
      const res = await api.post<ShipmentCreateResp>("/api/lt5/shipments", payload);
      const id = res.data?.data?.shipmentId;

      setToast({
        message: id ? `Đã tạo shipment #${id}` : "Đã tạo shipment thành công",
        type: "success",
      });
    } catch (error: any) {
      setToast({
        message:
          error?.response?.data?.message ||
          `Create shipment thất bại: ${error?.message || "Unknown error"}`,
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="lt5ship-page">
      <div className="lt5ship-aura" />

      <div className="lt5ship-topbar">
        <button
          type="button"
          className="lt5ship-btn lt5ship-btn--ghost"
          onClick={() => {
            if (window.history.length > 1) navigate(-1);
            else navigate("/admin");
          }}
        >
          <ArrowLeft size={16} />
          Quay lại
        </button>

        <button
          type="button"
          className="lt5ship-btn lt5ship-btn--soft"
          onClick={() => void fetchProfiles()}
          disabled={loadingList}
        >
          {loadingList ? <Loader2 className="lt5ship-spin" size={16} /> : <RefreshCcw size={16} />}
          Làm mới profiles
        </button>
      </div>

      <section className="lt5ship-hero">
        <div className="lt5ship-hero__content">
          <div className="lt5ship-kicker">
            <Sparkles size={15} /> LT5 SHIPMENT COMMAND CENTER
          </div>
          <h1>Tạo shipment LT5 nhanh, sạch và ít sai serial hơn</h1>
          <p>
            Chọn đúng logger profile, nhập tối đa 5 serial và cấu hình thời gian truyền dữ liệu. Mọi thiết bị trong shipment sẽ dùng chung loggerProfileId đã chọn.
          </p>
        </div>

        <div className="lt5ship-hero__card">
          <span>Profile đang chọn</span>
          <strong>{selected ? `#${selected.profileId}` : "—"}</strong>
          <small>{selected ? selectedProfileName : "Chưa có profile"}</small>
        </div>
      </section>

      <section className="lt5ship-stats" aria-label="Thống kê profiles">
        <div className="lt5ship-stat">
          <Cpu size={18} />
          <span>Tổng profiles</span>
          <strong>{profileStats.total}</strong>
        </div>
        <div className="lt5ship-stat">
          <ShieldAlert size={18} />
          <span>Có alarm</span>
          <strong>{profileStats.withAlarm}</strong>
        </div>
        <div className="lt5ship-stat">
          <Clock3 size={18} />
          <span>Interval nhanh</span>
          <strong>{profileStats.fast}</strong>
        </div>
        <div className="lt5ship-stat">
          <PackagePlus size={18} />
          <span>Serial hợp lệ</span>
          <strong>{serials.length}/5</strong>
        </div>
      </section>

      <div className="lt5ship-layout">
        <section className="lt5ship-panel lt5ship-profiles">
          <div className="lt5ship-panel__head">
            <div>
              <h2>Logger profiles</h2>
              <p>Chọn cấu hình trước khi tạo shipment.</p>
            </div>
            {loadingDetail && <Loader2 className="lt5ship-spin" size={18} />}
          </div>

          <div className="lt5ship-search">
            <Search size={16} />
            <input
              value={profileQuery}
              onChange={(e) => setProfileQuery(e.target.value)}
              placeholder="Tìm profile, model, sensor..."
            />
          </div>

          <div className="lt5ship-tabs" role="tablist" aria-label="Lọc profile">
            <button
              type="button"
              className={profileFilter === "all" ? "active" : ""}
              onClick={() => setProfileFilter("all")}
            >
              Tất cả
            </button>
            <button
              type="button"
              className={profileFilter === "alarm" ? "active" : ""}
              onClick={() => setProfileFilter("alarm")}
            >
              Có alarm
            </button>
            <button
              type="button"
              className={profileFilter === "noAlarm" ? "active" : ""}
              onClick={() => setProfileFilter("noAlarm")}
            >
              Không alarm
            </button>
            <button
              type="button"
              className={profileFilter === "fast" ? "active" : ""}
              onClick={() => setProfileFilter("fast")}
            >
              Nhanh
            </button>
          </div>

          <div className="lt5ship-profile-list">
            {loadingList && profiles.length === 0 ? (
              Array.from({ length: 5 }).map((_, i) => <div className="lt5ship-skeleton" key={i} />)
            ) : filteredProfiles.length === 0 ? (
              <div className="lt5ship-empty">Không có profile phù hợp.</div>
            ) : (
              filteredProfiles.map((p) => {
                const active = p.profileId === selectedId;
                const alarmCount = (p.alarms || []).length;

                return (
                  <button
                    type="button"
                    key={p.profileId}
                    className={`lt5ship-profile-card ${active ? "active" : ""}`}
                    onClick={() => setSelectedId(p.profileId)}
                  >
                    <div className="lt5ship-profile-card__top">
                      <strong>{p.name || "Profile chưa đặt tên"}</strong>
                      <span>#{p.profileId}</span>
                    </div>
                    <div className="lt5ship-profile-card__meta">
                      <span>{p.model || "N/A"}</span>
                      <span>{fmtMins(p.recordingIntervalInSeconds)}</span>
                      <span>{alarmCount} alarm</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section className="lt5ship-panel lt5ship-detail">
          <div className="lt5ship-panel__head lt5ship-panel__head--split">
            <div>
              <h2>Profile preview</h2>
              <p>Kiểm tra cấu hình trước khi gắn serial.</p>
            </div>

            <button
              type="button"
              className="lt5ship-icon-btn"
              onClick={() => void copyProfileId()}
              disabled={!selected}
              title="Copy profileId"
            >
              <CheckCircle2 size={16} />
            </button>
          </div>

          {!selected ? (
            <div className="lt5ship-empty lt5ship-empty--large">
              <Info size={20} /> Chọn một logger profile để xem chi tiết.
            </div>
          ) : (
            <>
              <div className="lt5ship-profile-spotlight">
                <div>
                  <span>LOGGER PROFILE</span>
                  <h3>{selectedProfileName}</h3>
                  <p>
                    loggerProfileId <strong>#{selected.profileId}</strong> • model {selected.model || "N/A"}
                  </p>
                </div>
                <div className="lt5ship-status-stack">
                  <span className={selected.alarmIndicatorEnabled ? "on" : "off"}>
                    Alarm LED {selected.alarmIndicatorEnabled ? "On" : "Off"}
                  </span>
                  <span className={selected.allowLoggingStop ? "on" : "off"}>
                    Stop log {selected.allowLoggingStop ? "Allow" : "Block"}
                  </span>
                </div>
              </div>

              <div className="lt5ship-metric-grid">
                <div>
                  <span>Recording interval</span>
                  <strong>{fmtMins(selected.recordingIntervalInSeconds)}</strong>
                </div>
                <div>
                  <span>Start delay</span>
                  <strong>{fmtMins(selected.startDelayInSeconds)}</strong>
                </div>
                <div>
                  <span>Alarm rules</span>
                  <strong>{alarms.length}</strong>
                </div>
              </div>

              <div className="lt5ship-alarm-box">
                <div className="lt5ship-section-title">
                  <ShieldAlert size={16} /> Alarm rules
                </div>

                {alarms.length === 0 ? (
                  <div className="lt5ship-muted-box">Profile này không có alarm rule.</div>
                ) : (
                  <div className="lt5ship-alarm-list">
                    {alarms.slice(0, 6).map((a, idx) => (
                      <div className="lt5ship-alarm-card" key={`${idx}-${a.sensor}-${a.isUpper}-${a.thresholdValue ?? "na"}`}>
                        <div>
                          <strong>{sensorLabel(a.sensor)}</strong>
                          <span>{boundLabel(!!a.isUpper)} • {triggerLabel(a.alarmTriggerType)}</span>
                        </div>
                        <b>{a.thresholdValue ?? "N/A"}</b>
                        <small>{a.numberOfReadingsBeforeAlert ?? "N/A"} readings</small>
                      </div>
                    ))}
                    {alarms.length > 6 && (
                      <div className="lt5ship-muted-box">Còn {alarms.length - 6} rule khác.</div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      <form className="lt5ship-builder lt5ship-panel" onSubmit={submitCreateShipment}>
        <div className="lt5ship-panel__head lt5ship-panel__head--split">
          <div>
            <h2>Next: Create shipment</h2>
            <p>POST <code>/api/lt5/shipments</code> với profile và danh sách serial đã chọn.</p>
          </div>
          <span className="lt5ship-counter">Devices {devices.length}/5</span>
        </div>

        <div className="lt5ship-form-grid">
          <label className="lt5ship-field">
            <span>Shipment name</span>
            <input
              value={shipmentName}
              onChange={(e) => setShipmentName(e.target.value)}
              placeholder="VD: LT5 Shipment - Dec"
              disabled={submitting}
            />
          </label>

          <label className="lt5ship-field">
            <span>Start time <b>*</b></span>
            <input
              type="datetime-local"
              value={startLocal}
              onChange={(e) => setStartLocal(e.target.value)}
              disabled={submitting}
            />
          </label>

          <label className="lt5ship-field">
            <span>End time</span>
            <input
              type="datetime-local"
              value={endLocal}
              onChange={(e) => setEndLocal(e.target.value)}
              disabled={submitting}
            />
          </label>

          <label className="lt5ship-field">
            <span>Transmission</span>
            <select
              value={txMinutes}
              onChange={(e) => setTxMinutes(Number(e.target.value))}
              disabled={submitting}
            >
              {transmissionOptions.map((m) => (
                <option key={m} value={m}>
                  {fmtTx(m)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="lt5ship-presets">
          <button type="button" onClick={() => setStartPreset("now")}>Bắt đầu ngay</button>
          <button type="button" onClick={() => setStartPreset("plus1h")}>Sau 1 giờ</button>
          <button type="button" onClick={() => setStartPreset("tomorrow")}>Ngày mai</button>
        </div>

        <div className="lt5ship-serial-head">
          <div>
            <h3>Serial devices</h3>
            <p>Nhập tối đa 5 serial. Serial sẽ được tự chuẩn hoá thành chữ hoa khi submit.</p>
          </div>
          <button
            type="button"
            className="lt5ship-btn lt5ship-btn--soft"
            onClick={addDeviceRow}
            disabled={submitting || devices.length >= 5}
          >
            <Plus size={16} /> Thêm serial
          </button>
        </div>

        <div className="lt5ship-serial-list">
          {devices.map((d, idx) => {
            const clean = normSerial(d.serialNumber);
            const dup = clean && duplicateSerials.has(clean);

            return (
              <div className={`lt5ship-serial-row ${dup ? "has-error" : ""}`} key={idx}>
                <div className="lt5ship-serial-index">{idx + 1}</div>
                <input
                  value={d.serialNumber}
                  onChange={(e) => updateDeviceRow(idx, e.target.value)}
                  placeholder="VD: A0D80016157C"
                  disabled={submitting}
                />
                <span className="lt5ship-serial-normalized">
                  {clean || "SERIAL"}{dup ? " • Trùng" : ""}
                </span>
                <button
                  type="button"
                  className="lt5ship-icon-danger"
                  onClick={() => removeDeviceRow(idx)}
                  disabled={submitting || devices.length <= 1}
                  title="Xoá serial"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
        </div>

        <div className="lt5ship-submit-bar">
          <div>
            <CalendarClock size={16} />
            <span>
              Profile áp dụng: <strong>{selected ? `#${selected.profileId}` : "chưa chọn"}</strong> • Transmission {fmtTx(txMinutes)}
            </span>
          </div>
          <button type="submit" className="lt5ship-btn lt5ship-btn--primary" disabled={!canCreate}>
            {submitting ? <Loader2 className="lt5ship-spin" size={17} /> : <Send size={17} />}
            Create shipment
          </button>
        </div>
      </form>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
          durationMs={toast.type === "success" ? 1800 : 3200}
        />
      )}
    </main>
  );
}
