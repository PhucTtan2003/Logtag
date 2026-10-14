// src/pages/User/User.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlarmClock, Volume2, VolumeX } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import {
  useEventsRealtime,
  type LiveAlertDto,
} from "../../hooks/useEventsRealtime";
import "../../styles/User/UserPage.css";
import "../../styles/User/ScheduledSmsSettingsPage.css";
import "../../styles/User/UserPlanOverview.css";


import UserChartPage from "./UserChartPage";
import RedeemCodeForm from "../../components/RedeemCodeForm";
import FeatureGate from "../../components/FeatureGate";
import { useSubscriptionCtx } from "../../contexts/SubscriptionProvider";
import SmsSettingsPage from "./SmsSettingsPage";
import ScheduledSmsSettingsPage from "./ScheduledSmsSettingPage";
import UserLicenseList from "../../components/UserLicenseList";
import UserAlertThresholds from "./UserAlertThresholds";
import UserDeviceNames from "./UserDeviceNames";
import {
  monthlyReportsApi,
  type SaveMonthlyReportScheduleRequest,
} from "../../services/monthlyReportsApi";

/* ============================= Realtime helpers ============================= */
type AlertType =
  | "temperature_high"
  | "temperature_low"
  | "power_loss"
  | "power_restore"
  | "battery_low"
  | "other";

type Severity = "critical" | "warning" | "info";

const parseAlertType = (msg: string): AlertType => {
  const m = (msg || "").toLowerCase();

  if (m.includes("power loss")) return "power_loss";
  if (m.includes("power restored") || m.includes("power restore"))
    return "power_restore";
  if (m.includes("battery") && m.includes("low")) return "battery_low";

  if (m.includes("temperature") && m.includes("alarm")) {
    if (m.includes("high")) return "temperature_high";
    if (m.includes("low")) return "temperature_low";
    return "temperature_high";
  }

  if (m.includes("mất nguồn")) return "power_loss";
  if (m.includes("khôi phục") && m.includes("nguồn")) return "power_restore";
  if (m.includes("pin") && (m.includes("yếu") || m.includes("thấp")))
    return "battery_low";

  if (m.includes("vượt ngưỡng")) {
    if (m.includes("trên")) return "temperature_high";
    if (m.includes("dưới")) return "temperature_low";
    return "temperature_high";
  }

  return "other";
};

const getSeverity = (a: LiveAlertDto): Severity => {
  const typ = parseAlertType(a.message);

  if (
    typ === "power_loss" ||
    typ === "temperature_high" ||
    typ === "battery_low"
  ) {
    return "critical";
  }

  if (typ === "temperature_low") return "warning";
  if (typ === "power_restore") return "info";

  return "warning";
};

const getAlertLabel = (typ: AlertType) => {
  switch (typ) {
    case "power_loss":
      return "Mất nguồn";
    case "power_restore":
      return "Nguồn đã khôi phục";
    case "battery_low":
      return "Pin yếu";
    case "temperature_high":
      return "Nhiệt độ cao";
    case "temperature_low":
      return "Nhiệt độ thấp";
    default:
      return "Thông báo";
  }
};

const formatDateTime = (value?: string | Date | null) => {
  if (!value) return "—";

  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";

  return d.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

const formatNumberVi = (value?: number | null) => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }

  return new Intl.NumberFormat("vi-VN").format(value);
};

const subscriptionPlanLabel = (plan?: string | null) => {
  const key = String(plan || "basic")
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "_");

  const labels: Record<string, string> = {
    basic: "Basic",
    pro: "Pro LTGEO",
    premium: "Premium",
    sms: "SMS cảnh báo",
    sms_schedule: "SMS định kỳ",
    sms_1000_year: "SMS 1.000 tin / năm",
    sms_10000_year: "SMS 10.000 tin / năm",
    sms_unlimited_year: "SMS không giới hạn / năm",
    sms_custom: "SMS tùy số lượng",
    sms_custom_year: "SMS tùy số lượng / năm",
  };

  return labels[key] || key.replace(/_/g, " ").toUpperCase();
};

const subscriptionFeatureLabel = (feature: string) => {
  const labels: Record<string, string> = {
    sms_alert: "SMS cảnh báo",
    sms_schedule: "SMS định kỳ",
    advanced_devices: "Thiết bị nâng cao",
    alert_history_90d: "Lịch sử cảnh báo 90 ngày",
    priority_alerts: "Cảnh báo ưu tiên",
    advanced_export: "Xuất dữ liệu nâng cao",
  };

  return labels[feature] || feature.replace(/_/g, " ");
};

const getAlertTime = (a: Partial<LiveAlertDto> | any): Date | null => {
  const raw =
    a?.timeUtc ??
    a?.TimeUtc ??
    a?.time ??
    a?.Time ??
    a?.createdAt ??
    a?.CreatedAt ??
    a?.dateUtc ??
    a?.DateUtc ??
    null;

  if (!raw) return null;

  const d = raw instanceof Date ? raw : new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
};

const isSameLocalDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const isTodayAlert = (a: Partial<LiveAlertDto> | any) => {
  const d = getAlertTime(a);

  // Không có thời gian rõ ràng thì bỏ qua để tránh hiện lại cảnh báo cũ/seed lỗi.
  if (!d) return false;

  return isSameLocalDay(d, new Date());
};

const clearStoredRecentAlert = () => {
  try {
    sessionStorage.removeItem("recentAlert");
    sessionStorage.removeItem("recentAlertKey");
    sessionStorage.removeItem("recentAlertDismissedKey");
  } catch {
    // ignore
  }
};

/* ============================= Alert sound repeat ============================= */
// Người dùng chỉ chọn 1 lần hoặc 3 lần.
// Giá trị được giữ lại khi tải lại trang.
const ALERT_REPEAT_STORAGE_KEY = "user_alert_repeat_count_v2";
const ALERT_REPEAT_OPTIONS = [1,2,3,4,5,6,7] as const;
type AlertRepeatCount = (typeof ALERT_REPEAT_OPTIONS)[number];
const DEFAULT_ALERT_REPEAT_COUNT: AlertRepeatCount = 1;

const normalizeAlertRepeatCount = (
  value: unknown,
): AlertRepeatCount => {
  const parsed = Math.floor(Number(value));

  if (
    ALERT_REPEAT_OPTIONS.includes(
      parsed as AlertRepeatCount,
    )
  ) {
    return parsed as AlertRepeatCount;
  }

  return DEFAULT_ALERT_REPEAT_COUNT;
};

const loadStoredAlertRepeatCount = (): AlertRepeatCount => {
  try {
    return normalizeAlertRepeatCount(
      localStorage.getItem(ALERT_REPEAT_STORAGE_KEY),
    );
  } catch {
    return DEFAULT_ALERT_REPEAT_COUNT;
  }
};

/* ============================= Alarm clock ============================= */
type AlarmItem = {
  id: string;
  hour: number;
  minute: number;
  label?: string;
  repeatDaily: boolean;
  enabled: boolean;
  nextTs?: number;
};

type UseAlarmClockReturn = {
  alarms: AlarmItem[];
  addAlarm: (p: {
    hour: number;
    minute: number;
    label?: string;
    repeatDaily: boolean;
  }) => void;
  removeAlarm: (id: string) => void;
  toggleAlarm: (id: string) => void;
  stopRinging: () => void;
  modalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
};

const safeUUID = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `alarm_${Date.now()}_${Math.random().toString(36).slice(2)}`;

const computeNextTs = (h: number, m: number) => {
  const now = new Date();
  const next = new Date();

  next.setHours(h, m, 0, 0);

  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  return next.getTime();
};

function useAlarmClock(
  reminderRef: React.RefObject<HTMLAudioElement | null>,
  soundEnabled: boolean,
  ringRepeatCount: AlertRepeatCount,
  userId?: string | number | null,
): UseAlarmClockReturn {
  const [alarms, setAlarms] = useState<AlarmItem[]>([]);
  const [modalOpen, setModalOpen] = useState(false);

  const ringLeftRef = useRef(0);
  const endedHandlerRef = useRef<
    ((this: HTMLMediaElement, ev: Event) => any) | null
  >(null);

  const keyFor = (uid?: string | number | null) =>
    uid != null ? `alarms:${uid}` : "alarms:__guest__";

  const persist = (list: AlarmItem[]) => {
    try {
      localStorage.setItem(keyFor(userId), JSON.stringify(list));
    } catch {
      // ignore
    }
  };

  const startRingTimes = (times: number) => {
    const el = reminderRef.current;
    if (!el) return;

    if (endedHandlerRef.current) {
      el.removeEventListener("ended", endedHandlerRef.current);
      endedHandlerRef.current = null;
    }

    ringLeftRef.current = Math.max(1, Math.floor(times));

    const onEnded = () => {
      if (ringLeftRef.current > 1) {
        ringLeftRef.current -= 1;
        el.currentTime = 0;
        el.play().catch(() => {});
      } else {
        el.removeEventListener("ended", onEnded);
        endedHandlerRef.current = null;
      }
    };

    endedHandlerRef.current = onEnded;

    try {
      el.currentTime = 0;
      el.play().catch(() => {});
    } catch {
      // ignore
    }

    el.addEventListener("ended", onEnded);
  };

  useEffect(() => {
    try {
      const legacy = localStorage.getItem("user_alarms_v1");

      if (legacy && !localStorage.getItem(keyFor(userId))) {
        localStorage.setItem(keyFor(userId), legacy);
        localStorage.removeItem("user_alarms_v1");
      }

      const raw = localStorage.getItem(keyFor(userId));
      const list = raw ? (JSON.parse(raw) as AlarmItem[]) : [];

      const initial = (Array.isArray(list) ? list : []).map((a) =>
        a.enabled
          ? { ...a, nextTs: a.nextTs ?? computeNextTs(a.hour, a.minute) }
          : { ...a, nextTs: undefined },
      );

      setAlarms(initial);
    } catch {
      setAlarms([]);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = () => {
      setAlarms((prev) => {
        const now = Date.now();
        let changed = false;

        const nextList = prev.map((a) => {
          if (!a.enabled || a.nextTs == null) return a;
          if (now < a.nextTs) return a;

          if (soundEnabled) startRingTimes(ringRepeatCount);

          changed = true;

          return a.repeatDaily
            ? { ...a, nextTs: computeNextTs(a.hour, a.minute) }
            : { ...a, enabled: false, nextTs: undefined };
        });

        if (!changed) return prev;

        persist(nextList);
        return nextList;
      });
    };

    timer = setInterval(tick, 1000);

    const onVis = () => {
      if (document.hidden) {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      } else if (!timer) {
        timer = setInterval(tick, 1000);
      }
    };

    document.addEventListener("visibilitychange", onVis);

    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soundEnabled, ringRepeatCount, reminderRef, userId]);

  const addAlarm: UseAlarmClockReturn["addAlarm"] = ({
    hour,
    minute,
    label,
    repeatDaily,
  }) => {
    const hh = Math.max(0, Math.min(23, hour | 0));
    const mm = Math.max(0, Math.min(59, minute | 0));

    const item: AlarmItem = {
      id: safeUUID(),
      hour: hh,
      minute: mm,
      label: (label || "").trim(),
      repeatDaily,
      enabled: true,
      nextTs: computeNextTs(hh, mm),
    };

    setAlarms((prev) => {
      const next = [item, ...prev].slice(0, 20);
      persist(next);
      return next;
    });
  };

  const removeAlarm: UseAlarmClockReturn["removeAlarm"] = (id) => {
    setAlarms((prev) => {
      const next = prev.filter((x) => x.id !== id);
      persist(next);
      return next;
    });
  };

  const toggleAlarm: UseAlarmClockReturn["toggleAlarm"] = (id) => {
    setAlarms((prev) => {
      let changed = false;

      const next = prev.map((a) => {
        if (a.id !== id) return a;

        changed = true;

        const enabled = !a.enabled;

        return {
          ...a,
          enabled,
          nextTs: enabled ? computeNextTs(a.hour, a.minute) : undefined,
        };
      });

      if (changed) persist(next);

      return next;
    });
  };

  const stopRinging = () => {
    try {
      const el = reminderRef.current;
      if (!el) return;

      if (endedHandlerRef.current) {
        el.removeEventListener("ended", endedHandlerRef.current);
        endedHandlerRef.current = null;
      }

      ringLeftRef.current = 0;
      el.pause();
      el.currentTime = 0;
    } catch {
      // ignore
    }
  };

  return {
    alarms,
    addAlarm,
    removeAlarm,
    toggleAlarm,
    stopRinging,
    modalOpen,
    openModal: () => setModalOpen(true),
    closeModal: () => setModalOpen(false),
  };
}

/* ============================= Alarm Modal UI ============================= */
type AlarmModalProps = {
  visible: boolean;
  onClose: () => void;
  alarms: AlarmItem[];
  addAlarm: (p: {
    hour: number;
    minute: number;
    label?: string;
    repeatDaily: boolean;
  }) => void;
  removeAlarm: (id: string) => void;
  toggleAlarm: (id: string) => void;
  stopRinging: () => void;
  ringRepeatCount: AlertRepeatCount;
};

const AlarmModal: React.FC<AlarmModalProps> = ({
  visible,
  onClose,
  alarms,
  addAlarm,
  removeAlarm,
  toggleAlarm,
  stopRinging,
  ringRepeatCount,
}) => {
  const [hour, setHour] = useState(8);
  const [minute, setMinute] = useState(0);
  const [label, setLabel] = useState("");
  const [repeat, setRepeat] = useState(true);

  useEffect(() => {
    if (!visible) return;

    setHour(8);
    setMinute(0);
    setLabel("");
    setRepeat(true);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className="modal-overlay smart-modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="modal smart-alarm-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header smart-modal-header">
          <div>
            <h3>🕒 Cài báo thức kiểm tra thiết bị</h3>
            <p>
              Đặt nhắc nhở để kiểm tra dữ liệu, pin hoặc trạng thái thiết bị.
              Chuông hiện được phát {ringRepeatCount} lần.
            </p>
          </div>
        </div>

        <div className="alarm-form-grid">
          <label>
            Giờ
            <input
              type="number"
              min={0}
              max={23}
              value={hour}
              onChange={(e) => setHour(Number(e.target.value))}
            />
          </label>

          <label>
            Phút
            <input
              type="number"
              min={0}
              max={59}
              value={minute}
              onChange={(e) => setMinute(Number(e.target.value))}
            />
          </label>
        </div>

        <label className="alarm-label-field">
          Nhãn nhắc nhở
          <input
            type="text"
            value={label}
            placeholder="Ví dụ: Kiểm tra kho lạnh ca sáng"
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>

        <label className="alarm-repeat-row">
          <input
            type="checkbox"
            checked={repeat}
            onChange={(e) => setRepeat(e.target.checked)}
          />
          <span>Lặp lại mỗi ngày</span>
        </label>

        <div className="modal-footer smart-modal-footer">
          <button className="btn ghost" onClick={onClose}>
            Hủy
          </button>

          <button
            className="btn btn-primary"
            onClick={() => {
              addAlarm({
                hour,
                minute,
                label,
                repeatDaily: repeat,
              });
              onClose();
            }}
          >
            Lưu báo thức
          </button>
        </div>

        <div className="alarm-list-header">Báo thức đã đặt</div>

        {alarms.length === 0 ? (
          <div className="alarm-empty">Chưa có báo thức nào.</div>
        ) : (
          <ul className="alarm-list">
            {alarms.map((a) => (
              <li key={a.id} className="alarm-item">
                <div>
                  <div className="alarm-time">
                    {String(a.hour).padStart(2, "0")}:
                    {String(a.minute).padStart(2, "0")}
                  </div>

                  <div className="alarm-meta">
                    {a.label || "Không có nhãn"} •{" "}
                    {a.repeatDaily ? "Lặp hằng ngày" : "1 lần"}
                    {!a.enabled ? " • Đã tắt" : ""}
                  </div>
                </div>

                <div className="alarm-actions">
                  <button
                    className="btn ghost"
                    onClick={() => toggleAlarm(a.id)}
                  >
                    {a.enabled ? "Tắt" : "Bật"}
                  </button>

                  <button
                    className="btn danger"
                    onClick={() => removeAlarm(a.id)}
                  >
                    Xóa
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="alarm-stop-row">
          <button className="btn ghost" onClick={stopRinging}>
            Tắt chuông đang kêu
          </button>
        </div>
      </div>
    </div>
  );
};

/* ============================= Monthly Report Modal UI ============================= */
type MonthlyReportModalProps = {
  visible: boolean;
  onClose: () => void;
  defaultEmail?: string;
};

type MonthlyReportFormState = {
  teamId: string;
  serialNumbersText: string;
  recipientsText: string;
  ccText: string;
  sendDayOfMonth: number;
  sendTimeLocal: string;
  isEnabled: boolean;
  includeRawData: boolean;
  includeAlerts: boolean;
};

const splitLinesOrCommas = (value: string) =>
  (value || "")
    .split(/[\n,;]+/g)
    .map((x) => x.trim())
    .filter(Boolean);

const joinList = (value?: string[]) => (value || []).join("\n");

const MonthlyReportModal: React.FC<MonthlyReportModalProps> = ({
  visible,
  onClose,
  defaultEmail = "",
}) => {
  const [form, setForm] = useState<MonthlyReportFormState>({
    teamId: "16922",
    serialNumbersText: "",
    recipientsText: defaultEmail || "",
    ccText: "",
    sendDayOfMonth: 1,
    sendTimeLocal: "08:00",
    isEnabled: true,
    includeRawData: true,
    includeAlerts: true,
  });

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const patchForm = <K extends keyof MonthlyReportFormState>(
    key: K,
    value: MonthlyReportFormState[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  useEffect(() => {
    if (!visible) return;

    let disposed = false;
    setMessage("");
    setError("");
    setLoading(true);
    setEditingId(null);

    monthlyReportsApi
      .listMySchedules()
      .then((items) => {
        if (disposed) return;

        const latest = items?.[0];
        if (!latest) {
          setForm((prev) => ({
            ...prev,
            recipientsText: prev.recipientsText || defaultEmail || "",
          }));
          return;
        }

        setEditingId(latest.id);

        setForm({
          teamId: String(latest.teamId || 16922),
          serialNumbersText: joinList(latest.serialNumbers),
          recipientsText: joinList(latest.recipients) || defaultEmail || "",
          ccText: joinList(latest.cc),
          sendDayOfMonth: latest.sendDayOfMonth || 1,
          sendTimeLocal: latest.sendTimeLocal || "08:00",
          isEnabled: latest.isEnabled !== false,
          includeRawData: latest.includeRawData !== false,
          includeAlerts: latest.includeAlerts !== false,
        });
      })
      .catch((e) => {
        if (disposed) return;
        console.warn("[MonthlyReport] load schedules failed", e);
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [visible, defaultEmail]);

  if (!visible) return null;

  const buildPayload = (): SaveMonthlyReportScheduleRequest => {
    const teamId = Number(form.teamId);
    const serialNumbers = splitLinesOrCommas(form.serialNumbersText).map((x) =>
      x.toUpperCase(),
    );
    const recipients = splitLinesOrCommas(form.recipientsText);
    const cc = splitLinesOrCommas(form.ccText);

    if (!Number.isFinite(teamId) || teamId <= 0) {
      throw new Error("TeamId không hợp lệ.");
    }

    if (serialNumbers.length === 0) {
      throw new Error("Vui lòng nhập ít nhất 1 serial thiết bị.");
    }

    if (recipients.length === 0) {
      throw new Error("Vui lòng nhập ít nhất 1 email nhận report.");
    }

    return {
      teamId,
      serialNumbers,
      recipients,
      cc,
      sendDayOfMonth: Math.max(
        1,
        Math.min(31, Number(form.sendDayOfMonth) || 1),
      ),
      sendTimeLocal: form.sendTimeLocal || "08:00",
      timeZoneId: "Asia/Ho_Chi_Minh",
      format: "csv",
      isEnabled: form.isEnabled,
      includeSummary: true,
      includeRawData: form.includeRawData,
      includeAlerts: form.includeAlerts,
    };
  };

  const saveSchedule = async (sendTestAfterSave: boolean) => {
    setSaving(true);
    setMessage("");
    setError("");

    try {
      const payload = buildPayload();
      const saved = editingId
        ? await monthlyReportsApi.updateSchedule(editingId, payload)
        : await monthlyReportsApi.createSchedule(payload);

      if (saved?.id) setEditingId(saved.id);

      if (sendTestAfterSave) {
        await monthlyReportsApi.sendTest(saved.id);
        setMessage(
          "Đã lưu lịch và gửi thử report tháng trước. Vui lòng kiểm tra email người nhận.",
        );
      } else {
        setMessage("Đã lưu lịch gửi report tháng thành công.");
      }
    } catch (e: any) {
      setError(
        e?.response?.data?.message ||
          e?.message ||
          "Không thể lưu/gửi report. Vui lòng kiểm tra lại cấu hình.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="monthly-report-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="monthly-report-title"
      onClick={saving ? undefined : onClose}
    >
      <div
        className="monthly-report-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="monthly-report-hero">
          <div className="monthly-report-hero__content">
            <div className="monthly-report-hero__icon" aria-hidden="true">
              📊
            </div>

            <div>
              <span className="monthly-report-eyebrow">Monthly LogTag Report</span>
              <h3 id="monthly-report-title">Gửi report tháng</h3>
              <p>
                Lên lịch gửi báo cáo LogTag tự động theo tháng. Report sẽ lấy
                dữ liệu của tháng trước và gửi đến danh sách email đã cấu hình.
              </p>
            </div>
          </div>

          <button
            type="button"
            className="monthly-report-close"
            onClick={onClose}
            disabled={saving}
            aria-label="Đóng cấu hình report tháng"
          >
            ×
          </button>
        </div>

        <div className="monthly-report-body">
          <div className="monthly-report-summary-grid" aria-label="Tóm tắt cấu hình report">
            <div className="monthly-report-summary-card">
              <span>Chu kỳ</span>
              <strong>Hằng tháng</strong>
            </div>

            <div className="monthly-report-summary-card">
              <span>Dữ liệu</span>
              <strong>Tháng trước</strong>
            </div>

            <div className="monthly-report-summary-card">
              <span>Định dạng</span>
              <strong>CSV</strong>
            </div>
          </div>

          {loading && (
            <div className="monthly-report-state monthly-report-state--loading">
              <span className="monthly-report-spinner" aria-hidden="true" />
              <span>Đang tải cấu hình report gần nhất...</span>
            </div>
          )}

          {message && (
            <div
              className="monthly-report-state monthly-report-state--success"
              role="status"
              aria-live="polite"
            >
              <b>Thành công.</b>
              <span>{message}</span>
            </div>
          )}

          {error && (
            <div className="monthly-report-state monthly-report-state--error" role="alert">
              <span className="monthly-report-state__icon">!</span>
              <div>
                <b>Không thể xử lý report</b>
                <span>{error}</span>
              </div>
            </div>
          )}

          {/* TeamId vẫn giữ trong state để gửi backend, nhưng không hiển thị cho User chỉnh. */}

          <section className="monthly-report-section">
            <div className="monthly-report-section__head">
              <div>
                <span>01</span>
                <h4>Lịch gửi tự động</h4>
              </div>
              <p>Chọn ngày và giờ hệ thống gửi report theo múi giờ Việt Nam.</p>
            </div>

            <div className="monthly-report-grid monthly-report-grid--three">
              <label className="monthly-report-field">
                <span>Ngày gửi hằng tháng</span>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={form.sendDayOfMonth}
                  onChange={(e) =>
                    patchForm("sendDayOfMonth", Number(e.target.value))
                  }
                />
              </label>

              <label className="monthly-report-field">
                <span>Giờ gửi</span>
                <input
                  type="time"
                  value={form.sendTimeLocal}
                  onChange={(e) => patchForm("sendTimeLocal", e.target.value)}
                />
              </label>

              <label className="monthly-report-field">
                <span>Định dạng</span>
                <input value="CSV" disabled />
              </label>
            </div>
          </section>

          <section className="monthly-report-section">
            <div className="monthly-report-section__head">
              <div>
                <span>02</span>
                <h4>Thiết bị cần xuất report</h4>
              </div>
              <p>Nhập mỗi serial trên một dòng hoặc phân tách bằng dấu phẩy.</p>
            </div>

            <label className="monthly-report-field monthly-report-field--full">
              <span>Serial thiết bị</span>
              <textarea
                value={form.serialNumbersText}
                placeholder={"Ví dụ:\nA0A5003073MH\nA0A5003331QT"}
                rows={5}
                onChange={(e) => patchForm("serialNumbersText", e.target.value)}
              />
            </label>
          </section>

          <section className="monthly-report-section">
            <div className="monthly-report-section__head">
              <div>
                <span>03</span>
                <h4>Email nhận báo cáo</h4>
              </div>
              <p>Có thể nhập nhiều email, mỗi email một dòng.</p>
            </div>

            <div className="monthly-report-grid">
              <label className="monthly-report-field monthly-report-field--full">
                <span>Email nhận report</span>
                <textarea
                  value={form.recipientsText}
                  placeholder={"Ví dụ:\ncustomer@example.com\nmanager@example.com"}
                  rows={4}
                  onChange={(e) => patchForm("recipientsText", e.target.value)}
                />
              </label>

              <label className="monthly-report-field monthly-report-field--full">
                <span>CC</span>
                <textarea
                  value={form.ccText}
                  placeholder="Email CC nếu có"
                  rows={3}
                  onChange={(e) => patchForm("ccText", e.target.value)}
                />
              </label>
            </div>
          </section>

          <section className="monthly-report-options">
            <label className="monthly-report-toggle">
              <input
                type="checkbox"
                checked={form.isEnabled}
                onChange={(e) => patchForm("isEnabled", e.target.checked)}
              />
              <span aria-hidden="true" />
              <div>
                <strong>Bật lịch gửi tự động hằng tháng</strong>
                <small>Report sẽ tự gửi theo ngày và giờ đã chọn.</small>
              </div>
            </label>

            <label className="monthly-report-toggle">
              <input
                type="checkbox"
                checked={form.includeRawData}
                onChange={(e) => patchForm("includeRawData", e.target.checked)}
              />
              <span aria-hidden="true" />
              <div>
                <strong>Đính kèm dữ liệu raw CSV</strong>
                <small>Gửi kèm file dữ liệu chi tiết của thiết bị.</small>
              </div>
            </label>

            <label className="monthly-report-toggle">
              <input
                type="checkbox"
                checked={form.includeAlerts}
                onChange={(e) => patchForm("includeAlerts", e.target.checked)}
              />
              <span aria-hidden="true" />
              <div>
                <strong>Bao gồm cảnh báo nếu backend hỗ trợ</strong>
                <small>Thêm danh sách cảnh báo phát sinh trong kỳ report.</small>
              </div>
            </label>
          </section>

          <div className="monthly-report-note">
            <b>Lưu ý:</b>
            <span>
              Nút gửi thử sẽ gửi report của tháng trước theo backend hiện tại.
              Muốn chọn tháng dữ liệu bất kỳ thì cần thêm endpoint backend riêng
              cho report theo tháng.
            </span>
          </div>
        </div>

        <div className="monthly-report-footer">
          <button
            type="button"
            className="monthly-report-btn monthly-report-btn--ghost"
            onClick={onClose}
            disabled={saving}
          >
            Đóng
          </button>

          <button
            type="button"
            className="monthly-report-btn monthly-report-btn--soft"
            onClick={() => saveSchedule(false)}
            disabled={saving || loading}
          >
            {saving ? "Đang lưu..." : editingId ? "Cập nhật lịch" : "Lưu lịch gửi"}
          </button>

          <button
            type="button"
            className="monthly-report-btn monthly-report-btn--primary"
            onClick={() => saveSchedule(true)}
            disabled={saving || loading}
          >
            {saving ? "Đang gửi..." : "Lưu & gửi thử"}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ============================= Main User Page ============================= */
const User: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, user } = useAuth();

  const [userView, setUserView] = useState<"monitor" | "subscription">("monitor");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [alertRepeatCount, setAlertRepeatCount] =
    useState<AlertRepeatCount>(loadStoredAlertRepeatCount);
  const [smsOpen, setSmsOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [thresholdOpen, setThresholdOpen] = useState(false);
  const [deviceNamesOpen, setDeviceNamesOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);

  const alarmRef = useRef<HTMLAudioElement | null>(null);
  const powerLossRef = useRef<HTMLAudioElement | null>(null);
  const reminderRef = useRef<HTMLAudioElement | null>(null);

  // Theo dõi handler "ended" để cảnh báo mới không cộng dồn listener cũ.
  const alertAudioEndedHandlersRef = useRef(
    new Map<HTMLAudioElement, () => void>(),
  );

  useEffect(() => {
    try {
      localStorage.setItem(
        ALERT_REPEAT_STORAGE_KEY,
        String(alertRepeatCount),
      );
    } catch {
      // ignore
    }
  }, [alertRepeatCount]);

  const [toasts, setToasts] = useState<LiveAlertDto[]>([]);
  const [recentAlert, setRecentAlert] = useState<LiveAlertDto | null>(null);
  const [recentVisible, setRecentVisible] = useState(false);

  const stopCurrentAlertSound = React.useCallback(() => {
    try {
      [powerLossRef.current, alarmRef.current, reminderRef.current].forEach(
        (el) => {
          if (!el) return;

          const repeatHandler =
            alertAudioEndedHandlersRef.current.get(el);

          if (repeatHandler) {
            el.removeEventListener("ended", repeatHandler);
            alertAudioEndedHandlersRef.current.delete(el);
          }

          el.pause();
          el.currentTime = 0;
        },
      );
    } catch {
      // ignore
    }
  }, []);

  const unlockAllAudio = React.useCallback(async () => {
    if (audioUnlocked) return true;

    const unlockOne = async (ref: React.RefObject<HTMLAudioElement | null>) => {
      const el = ref.current;
      if (!el) return false;

      try {
        el.muted = true;
        el.currentTime = 0;

        await el.play();

        el.pause();
        el.currentTime = 0;
        el.muted = false;

        return true;
      } catch (e) {
        console.warn("[AUDIO] unlock failed:", e);

        try {
          el.load();
        } catch {
          // ignore
        }

        return false;
      }
    };

    const ok1 = await unlockOne(alarmRef);
    const ok2 = await unlockOne(powerLossRef);
    const ok3 = await unlockOne(reminderRef);
    const ok = ok1 || ok2 || ok3;

    setAudioUnlocked(ok);

    return ok;
  }, [audioUnlocked]);

  const userId =
    (user as any)?.accountId ||
    (user as any)?.id ||
    (user as any)?.email ||
    null;

  const alarmAPI = useAlarmClock(
    reminderRef,
    soundEnabled,
    alertRepeatCount,
    userId,
  );
  const alarmApiRef = useRef(alarmAPI);

  useEffect(() => {
    alarmApiRef.current = alarmAPI;
  }, [alarmAPI]);

  /* ============================= UI idle recovery / anti-stuck overlay =============================
     Mục tiêu: khi để tab lâu, browser sleep có thể làm modal/drawer/toast/backdrop bị kẹt
     và chặn click toàn trang. Watchdog này sẽ tự dọn UI khi tab quay lại/focus lại.
  */
  const lastHiddenAtRef = useRef<number | null>(null);
  const lastUserActionAtRef = useRef<number>(Date.now());

  // Deep link từ UserSidebar: chỉ User page mở modal, không nhân đôi logic.
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const panel = query.get("panel");
    if (!panel) return;
    switch (panel) {
      case "subscription": setUserView("subscription"); break;
      case "monitor": setUserView("monitor"); break;
      case "threshold": setThresholdOpen(true); break;
      case "device-names": setDeviceNamesOpen(true); break;
      case "sms": setSmsOpen(true); break;
      case "sms-schedule": setScheduleOpen(true); break;
      case "monthly-report": setReportOpen(true); break;
      case "alarm": alarmAPI.openModal(); break;
      default: return;
    }
    // Xóa query bằng replace để việc đóng modal không mở lại khi refresh.
    navigate({ pathname: "/user", search: "" }, { replace: true });
  }, [location.search, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearBlockingUi = React.useCallback(
    (reason: string = "manual") => {
      setSmsOpen(false);
      setScheduleOpen(false);
      setThresholdOpen(false);
      setDeviceNamesOpen(false);
      setReportOpen(false);
      setToasts([]);

      try {
        alarmApiRef.current.closeModal();
        alarmApiRef.current.stopRinging();
        stopCurrentAlertSound();
      } catch {
        // ignore
      }

      try {
        document.body.style.overflow = "";
        document.body.style.pointerEvents = "";
        document.documentElement.style.overflow = "";
        document.documentElement.style.pointerEvents = "";
        document.body.classList.remove(
          "modal-open",
          "drawer-open",
          "sms-drawer-open",
        );
      } catch {
        // ignore
      }

      if (process.env.NODE_ENV !== "production") {
        console.info(`[UserUI] recovered blocking UI: ${reason}`);
      }
    },
    [stopCurrentAlertSound],
  );

  useEffect(() => {
    const RECOVER_AFTER_HIDDEN_MS = 5 * 60 * 1000;
    const SOFT_IDLE_MS = 30 * 60 * 1000;

    const markUserAction = () => {
      lastUserActionAtRef.current = Date.now();
    };

    const recoverIfNeeded = (reason: string, force = false) => {
      const now = Date.now();
      const hiddenAt = lastHiddenAtRef.current;
      const hiddenMs = hiddenAt ? now - hiddenAt : 0;
      const idleMs = now - lastUserActionAtRef.current;

      if (
        force ||
        hiddenMs >= RECOVER_AFTER_HIDDEN_MS ||
        idleMs >= SOFT_IDLE_MS
      ) {
        clearBlockingUi(reason);
        lastHiddenAtRef.current = null;
        lastUserActionAtRef.current = now;
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        lastHiddenAtRef.current = Date.now();
        return;
      }

      recoverIfNeeded("visibility-return");
    };

    const onFocus = () => recoverIfNeeded("window-focus");

    const onPageShow = (event: PageTransitionEvent) => {
      recoverIfNeeded(
        event.persisted ? "bfcache-pageshow" : "pageshow",
        event.persisted,
      );
    };

    const onKeyDown = (event: KeyboardEvent) => {
      markUserAction();

      if (event.key === "Escape") {
        clearBlockingUi("escape-key");
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("pointerdown", markUserAction, { passive: true });
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("pointerdown", markUserAction);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [clearBlockingUi]);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    let disposed = false;

    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await originalFetch(...args);

      if (!disposed && response.status === 401) {
        clearBlockingUi("auth-401");
        logout();
        localStorage.removeItem("token");
        navigate("/login", { replace: true });
      }

      return response;
    };

    return () => {
      disposed = true;
      window.fetch = originalFetch;
    };
  }, [clearBlockingUi, logout, navigate]);

  const playSoundTimes = React.useCallback(
    async (
      ref: React.RefObject<HTMLAudioElement | null>,
      times: AlertRepeatCount = alertRepeatCount,
    ) => {
      const el = ref.current;
      if (!el || !soundEnabled) return;

      if (!audioUnlocked) {
        const ok = await unlockAllAudio();

        if (!ok) {
          console.warn("[AUDIO] blocked (not unlocked yet)");
          return;
        }
      }

      // Cảnh báo mới đến thì hủy vòng lặp âm thanh cũ của cùng audio.
      const previousHandler =
        alertAudioEndedHandlersRef.current.get(el);

      if (previousHandler) {
        el.removeEventListener("ended", previousHandler);
        alertAudioEndedHandlersRef.current.delete(el);
      }

      let left = normalizeAlertRepeatCount(times);

      const handler = () => {
        left -= 1;

        if (left > 0 && soundEnabled) {
          el.currentTime = 0;
          el.play().catch((err) =>
            console.warn("[AUDIO] replay failed:", err),
          );
          return;
        }

        el.removeEventListener("ended", handler);
        alertAudioEndedHandlersRef.current.delete(el);
      };

      alertAudioEndedHandlersRef.current.set(el, handler);
      el.addEventListener("ended", handler);

      try {
        el.pause();
        el.currentTime = 0;
        await el.play();
      } catch (err) {
        el.removeEventListener("ended", handler);
        alertAudioEndedHandlersRef.current.delete(el);
        console.warn("[AUDIO] play failed:", err);
      }
    },
    [
      alertRepeatCount,
      audioUnlocked,
      soundEnabled,
      unlockAllAudio,
    ],
  );

  const alertKey = React.useCallback(
    (a: LiveAlertDto) => `${a.serialNumber}|${a.message}|${a.timeUtc}`,
    [],
  );

  useEventsRealtime({
    role: "user",
    onAlert: (items: LiveAlertDto | LiveAlertDto[]) => {
      const arr = Array.isArray(items) ? items : [items];

      // Chỉ hiện cảnh báo trong ngày hiện tại. Các alert cũ được seed lại từ hub sẽ bị bỏ qua.
      const todayAlerts = arr.filter(isTodayAlert);
      if (!todayAlerts.length) return;

      let playedThisBatch = false;

      for (const a of todayAlerts) {
        const key = alertKey(a);
        const dismissedKey = sessionStorage.getItem("recentAlertDismissedKey");

        if (soundEnabled && !playedThisBatch && dismissedKey !== key) {
          const typ = parseAlertType(a.message);

          try {
            if (typ === "power_loss") {
              void playSoundTimes(powerLossRef, alertRepeatCount);
              playedThisBatch = true;
            } else if (
              typ === "temperature_high" ||
              typ === "temperature_low" ||
              typ === "battery_low"
            ) {
              void playSoundTimes(alarmRef, alertRepeatCount);
              playedThisBatch = true;
            }
          } catch {
            // ignore
          }
        }

        // Toast xếp từ trên xuống: item mới nằm trên cùng, tự xóa đúng item sau 6 giây.
        setToasts((prev) => {
          const exists = prev.some((x) => alertKey(x) === key);
          if (exists) return prev;
          return [a, ...prev].slice(0, 5);
        });

        window.setTimeout(() => {
          setToasts((prev) => prev.filter((x) => alertKey(x) !== key));
        }, 6000);

        try {
          if (dismissedKey !== key) {
            setRecentAlert(a);
            setRecentVisible(true);
            sessionStorage.setItem("recentAlert", JSON.stringify(a));
            sessionStorage.setItem("recentAlertKey", key);
          }
        } catch {
          // ignore
        }
      }
    },
  });

  useEffect(() => {
    const onFirstGesture = () => {
      void unlockAllAudio();

      window.removeEventListener("touchstart", onFirstGesture);
      window.removeEventListener("mousedown", onFirstGesture);
      window.removeEventListener("keydown", onFirstGesture);
    };

    window.addEventListener("touchstart", onFirstGesture, { passive: true });
    window.addEventListener("mousedown", onFirstGesture);
    window.addEventListener("keydown", onFirstGesture);

    return () => {
      window.removeEventListener("touchstart", onFirstGesture);
      window.removeEventListener("mousedown", onFirstGesture);
      window.removeEventListener("keydown", onFirstGesture);
    };
  }, [unlockAllAudio]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("recentAlert");
      const key = sessionStorage.getItem("recentAlertKey");
      const dismissedKey = sessionStorage.getItem("recentAlertDismissedKey");

      if (raw && key && key !== dismissedKey) {
        const a = JSON.parse(raw) as LiveAlertDto;

        if (isTodayAlert(a)) {
          setRecentAlert(a);
          setRecentVisible(true);
        } else {
          clearStoredRecentAlert();
          setRecentAlert(null);
          setRecentVisible(false);
        }
      } else if (raw && key && key === dismissedKey) {
        const a = JSON.parse(raw) as LiveAlertDto;

        if (!isTodayAlert(a)) {
          clearStoredRecentAlert();
          setRecentAlert(null);
          setRecentVisible(false);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  const { me, loading } = useSubscriptionCtx();

  const daysLeft = Number.isFinite(me?.daysLeft)
    ? (me!.daysLeft as number)
    : undefined;
  const NEAR_THRESHOLD = 20;

  const state: "never" | "active" | "expired" =
    me?.startedAtUtc == null ? "never" : me?.isActive ? "active" : "expired";

  const isActive = state === "active";
  const isExpired = state === "expired";
  const isNever = state === "never";

  const isNearExpiry =
    isActive &&
    typeof daysLeft === "number" &&
    daysLeft > 0 &&
    daysLeft <= NEAR_THRESHOLD;

  const isLastDay = isActive && typeof daysLeft === "number" && daysLeft === 0;

  const displayName =
    (user as any)?.name ||
    (user as any)?.fullName ||
    (user as any)?.email ||
    (user as any)?.accountId ||
    "bạn";

  const userInitial =
    displayName.toString().trim().charAt(0).toUpperCase() || "?";

  const hasActiveAlert = !!recentAlert && recentVisible;
  const bannerType = hasActiveAlert
    ? parseAlertType(recentAlert!.message)
    : "other";
  const bannerSeverity = hasActiveAlert ? getSeverity(recentAlert!) : "info";

  const subscriptionLabel = loading
    ? "Đang kiểm tra"
    : isActive
      ? daysLeft != null
        ? `${daysLeft} ngày còn lại`
        : "Đang hoạt động"
      : isExpired
        ? "Đã hết hạn"
        : "BASIC";

  const subscriptionData = (me || {}) as any;

  const currentPlanTitle = subscriptionPlanLabel(subscriptionData.plan);
  const currentFeatures = Array.isArray(subscriptionData.features)
    ? subscriptionData.features.filter(Boolean)
    : [];

  const smsUnlimited = subscriptionData.smsUnlimited === true;

  const rawSmsTotal = Number(subscriptionData.smsQuotaTotal);
  const smsQuotaTotal =
    Number.isFinite(rawSmsTotal) && rawSmsTotal > 0
      ? rawSmsTotal
      : null;

  const rawSmsUsed = Number(subscriptionData.smsQuotaUsed);
  const smsQuotaUsed =
    Number.isFinite(rawSmsUsed) && rawSmsUsed > 0
      ? rawSmsUsed
      : 0;

  const rawSmsRemaining = Number(subscriptionData.smsRemaining);
  const smsRemaining = smsUnlimited
    ? null
    : Number.isFinite(rawSmsRemaining) && rawSmsRemaining >= 0
      ? rawSmsRemaining
      : smsQuotaTotal !== null
        ? Math.max(0, smsQuotaTotal - smsQuotaUsed)
        : null;

  const rawSmsWarnAt = Number(subscriptionData.smsWarnAtRemaining);
  const smsWarnAtRemaining =
    Number.isFinite(rawSmsWarnAt) && rawSmsWarnAt >= 0
      ? rawSmsWarnAt
      : null;

  const hasSmsFeature = currentFeatures.some(
    (feature: string) =>
      feature === "sms_alert" || feature === "sms_schedule",
  );

  const hasSmsQuota =
    smsUnlimited || (smsQuotaTotal !== null && smsQuotaTotal > 0);

  const smsUsagePercent =
    !smsUnlimited && smsQuotaTotal
      ? Math.min(100, Math.max(0, (smsQuotaUsed / smsQuotaTotal) * 100))
      : 0;

  const smsLow =
    !smsUnlimited &&
    smsRemaining !== null &&
    smsWarnAtRemaining !== null &&
    smsRemaining <= smsWarnAtRemaining;

  return (
    <div className="user-root user-root--friendly">
      <audio ref={alarmRef} src="/alert1.mp3" preload="auto" playsInline />
      <audio ref={powerLossRef} src="/turnof.mp3" preload="auto" playsInline />
      <audio
        ref={reminderRef}
        src="/checkdevice.mp3"
        preload="auto"
        playsInline
      />

      <div className="uf-aura uf-aura--one" />
      <div className="uf-aura uf-aura--two" />
      <div className="uf-aura uf-aura--three" />

      <div className="uf-page-content">
          <header className="uf-topbar uf-topbar--dashboard">
            <div className="uf-brand-zone">

              <div className="uf-brand-text"><span>SMARTTECH / MONITORING</span><b>{userView === "subscription" ? "Gói dịch vụ" : "Giám sát nhiệt độ"}</b></div>
            </div>
            <div className="uf-user-zone"><div className="uf-greeting"><span>Xin chào, {displayName}</span><b>Theo dõi dữ liệu thiết bị của bạn</b></div></div>
            <div className="uf-action-zone">
              <button className={`uf-icon-btn ${soundEnabled ? "" : "is-muted"}`} onClick={() => setSoundEnabled(v => !v)} title={soundEnabled ? "Tắt âm cảnh báo" : "Bật âm cảnh báo"} aria-label="Bật/tắt âm cảnh báo">{soundEnabled ? <Volume2 size={20}/> : <VolumeX size={20}/>}</button>
              <label className="uf-repeat-control" title="Số lần phát âm thanh cảnh báo"><span>🔁</span><select value={alertRepeatCount} disabled={!soundEnabled} onChange={e => setAlertRepeatCount(normalizeAlertRepeatCount(e.target.value))}>{ALERT_REPEAT_OPTIONS.map(n => <option key={n} value={n}>{n} lần</option>)}</select></label>
              <button className="uf-icon-btn" title="Báo thức" onClick={alarmAPI.openModal}><AlarmClock size={20}/></button>
              <div className="uf-avatar" title={displayName}>{userInitial}</div>
            </div>
          </header>
      {/* STATUS BANNER */}
      {hasActiveAlert ? (
        <section
          className={
            "uf-alert-strip " +
            (bannerSeverity === "critical"
              ? "uf-alert-strip--critical"
              : bannerSeverity === "warning"
                ? "uf-alert-strip--warning"
                : "uf-alert-strip--info")
          }
          role="status"
          aria-live="assertive"
        >
          <div className="uf-alert-icon">⚡</div>
          <div className="uf-alert-body">
            <span>
              {getAlertLabel(bannerType)} • {recentAlert!.serialNumber}
            </span>
            <b>{recentAlert!.message}</b>
            <small>{recentAlert!.notes || "Không có ghi chú"}</small>
          </div>
          <div className="uf-alert-actions">
            <button
              className="uf-btn uf-btn-primary"
              onClick={() => navigate("/events")}
            >
              Xem sự kiện
            </button>
            <button
              className="uf-btn uf-btn-soft"
              onClick={() => {
                if (recentAlert) {
                  const key = alertKey(recentAlert);
                  sessionStorage.setItem("recentAlertDismissedKey", key);
                }
                setRecentVisible(false);
                stopCurrentAlertSound();
              }}
            >
              Đã hiểu
            </button>
          </div>
        </section>
      ) : (
        <section
          className="uf-alert-strip uf-alert-strip--calm"
          role="status"
          aria-live="polite"
        >
          <div className="uf-alert-icon">🌿</div>
          <div className="uf-alert-body">
            <span>Trạng thái hiện tại</span>
            <b>Hệ thống đang ổn định</b>
            <small>
              Không phát hiện cảnh báo mới trong ngày. Bạn có thể tiếp tục theo
              dõi biểu đồ bên dưới.
            </small>
          </div>
        </section>
      )}

      {/* MAIN */}
      <main className="uf-main">
        <section className={`uf-workspace ${userView === "subscription" ? "uf-workspace--subscription" : "uf-workspace--monitor"}`}>
          <section className="uf-chart-panel" id="user-chart-area" style={{display: userView === "monitor" ? undefined : "none"}}>
            <div className="uf-section-head">
              <div>
                <span className="uf-kicker uf-kicker-light">MAIN MONITOR</span>
                <h2>Trung tâm giám sát</h2>
                <p>
                  Chọn thiết bị, xem diễn biến nhiệt độ và xuất dữ liệu ngay tại đây.
                </p>
              </div>
              <span className="uf-live-pill">Live</span>
            </div>

            <div className="uf-chart-frame">
              <UserChartPage />
            </div>
          </section>

          <aside className="uf-side-panel" style={{display: userView === "subscription" ? undefined : "none"}}>
            <section className="uf-plan-card ups-card" id="user-plan-area">
              <div className="ups-heading">
                <div>
                  <span className="uf-kicker uf-kicker-light">
                    SUBSCRIPTION
                  </span>
                  <h2>Gói dịch vụ của bạn</h2>
                  <p>
                    Theo dõi thời hạn, tính năng và hạn mức SMS đang sử dụng.
                  </p>
                </div>

                <span
                  className={
                    "ups-status " +
                    (loading
                      ? "ups-status--loading"
                      : isActive
                        ? "ups-status--active"
                        : isExpired
                          ? "ups-status--expired"
                          : "ups-status--basic")
                  }
                >
                  {loading
                    ? "Đang tải"
                    : isActive
                      ? "Đang hoạt động"
                      : isExpired
                        ? "Đã hết hạn"
                        : "Chưa kích hoạt"}
                </span>
              </div>

              <div className="ups-plan-hero">
                <div className="ups-plan-hero__copy">
                  <span>Gói hiện tại</span>
                  <strong>{currentPlanTitle}</strong>

                  <div className="ups-feature-list">
                    {currentFeatures.length > 0 ? (
                      currentFeatures.map((feature: string) => (
                        <span key={feature}>
                          {subscriptionFeatureLabel(feature)}
                        </span>
                      ))
                    ) : (
                      <span>Quyền cơ bản</span>
                    )}
                  </div>
                </div>

                <div className="ups-days">
                  <span>Thời hạn còn lại</span>
                  <strong>
                    {loading
                      ? "—"
                      : typeof daysLeft === "number"
                        ? daysLeft
                        : isActive
                          ? "∞"
                          : 0}
                  </strong>
                  <small>
                    {typeof daysLeft === "number" ? "ngày" : subscriptionLabel}
                  </small>
                </div>
              </div>

              {hasSmsFeature && (
                <section
                  className={
                    "ups-quota " +
                    (smsLow ? "ups-quota--low" : "") +
                    (!hasSmsQuota ? " ups-quota--pending" : "")
                  }
                >
                  <div className="ups-quota__head">
                    <div>
                      <span>Hạn mức SMS</span>
                      <strong>
                        {smsUnlimited
                          ? "Không giới hạn"
                          : hasSmsQuota
                            ? `${formatNumberVi(smsRemaining)} tin còn lại`
                            : "Đang chờ đồng bộ quota"}
                      </strong>
                    </div>

                    <span className="ups-quota__badge">
                      {smsUnlimited
                        ? "Unlimited"
                        : hasSmsQuota
                          ? `${Math.round(smsUsagePercent)}% đã dùng`
                          : "Chưa có dữ liệu"}
                    </span>
                  </div>

                  {!smsUnlimited && hasSmsQuota && (
                    <>
                      <div
                        className="ups-progress"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(smsUsagePercent)}
                      >
                        <span
                          style={{
                            width: `${smsUsagePercent}%`,
                          }}
                        />
                      </div>

                      <div className="ups-quota__stats">
                        <div>
                          <span>Tổng quota</span>
                          <b>{formatNumberVi(smsQuotaTotal)}</b>
                        </div>
                        <div>
                          <span>Đã sử dụng</span>
                          <b>{formatNumberVi(smsQuotaUsed)}</b>
                        </div>
                        <div>
                          <span>Còn lại</span>
                          <b>{formatNumberVi(smsRemaining)}</b>
                        </div>
                      </div>
                    </>
                  )}

                  {!hasSmsQuota && (
                    <p className="ups-quota__message">
                      Gói đã mở tính năng SMS nhưng API subscription chưa trả về
                      số lượng tin. Hãy tải lại sau khi backend đồng bộ các trường
                      <code> smsQuotaTotal</code>, <code>smsQuotaUsed</code> và
                      <code> smsRemaining</code>.
                    </p>
                  )}

                  {smsLow && (
                    <p className="ups-quota__message ups-quota__message--warning">
                      Quota SMS đang thấp. Vui lòng liên hệ quản trị viên để gia
                      hạn trước khi hết tin.
                    </p>
                  )}
                </section>
              )}

              {!loading && (isNearExpiry || isLastDay || isExpired) && (
                <div
                  className="uf-warning-card"
                  role="status"
                  aria-live="polite"
                >
                  <b>
                    {isExpired
                      ? "Gói đã hết hạn"
                      : isLastDay
                        ? "Hôm nay là ngày cuối"
                        : "Gói sắp hết hạn"}
                  </b>
                  <span>
                    {isExpired
                      ? "Bạn nên gia hạn để tiếp tục dùng các tính năng nâng cao."
                      : isLastDay
                        ? "Hãy gia hạn trong hôm nay để tránh gián đoạn."
                        : `Gói của bạn còn ${daysLeft} ngày.`}
                  </span>
                </div>
              )}

              {!loading && isNever && (
                <div className="uf-basic-card">
                  <b>Bạn đang dùng BASIC.</b>
                  <span>
                    Nâng cấp để mở khóa SMS, LTGeo và các tính năng nâng cao.
                  </span>
                </div>
              )}

              <div className="ups-license-section">
                <div className="ups-license-section__head">
                  <div>
                    <span>Mã đã kích hoạt</span>
                    <b>Lịch sử gói dịch vụ</b>
                  </div>
                </div>

                <div className="ups-license-shell">
                  <UserLicenseList />
                </div>
              </div>

              <div className="ups-redeem-section">
                <div>
                  <span>Gia hạn hoặc đổi gói</span>
                  <b>Nhập mã kích hoạt mới</b>
                </div>
                <RedeemCodeForm />
              </div>
            </section>

            <section className="uf-habit-card">
              <div className="uf-habit-item">
                <span>🛡️</span>
                <div>
                  <b>Giám sát an toàn</b>
                  <small>
                    Toast và banner sẽ báo ngay khi có cảnh báo mới trong ngày.
                  </small>
                </div>
              </div>
              <div className="uf-habit-item">
                <span>🕘</span>
                <div>
                  <b>Lần mở trang</b>
                  <small>{formatDateTime(new Date())}</small>
                </div>
              </div>
              <div className="uf-habit-item">
                <span>🔔</span>
                <div>
                  <b>Nhắc nhở cá nhân</b>
                  <small>
                    {alarmAPI.alarms.filter((x) => x.enabled).length} báo thức
                    đang hoạt động
                  </small>
                </div>
              </div>
            </section>
          </aside>
        </section>

      </main>
      </div>

      {/* Drawer SMS cảnh báo */}
      {smsOpen && (
        <div
          className="sms-drawer-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => setSmsOpen(false)}
        >
          <div
            className="sms-drawer sms-drawer--modern"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sms-drawer__header">
              <span className="sms-drawer__title">Thiết lập SMS cảnh báo</span>

              <button
                className="sms-drawer__close"
                onClick={() => setSmsOpen(false)}
                aria-label="Đóng"
              >
                ×
              </button>
            </div>

            <div className="sms-drawer__body">
              <SmsSettingsPage />
            </div>
          </div>
        </div>
      )}

      {/* Drawer SMS định kỳ */}
      {scheduleOpen && (
        <FeatureGate
          need="sms_schedule"
          fallback={
            <div
              className="sms-drawer-backdrop"
              role="dialog"
              aria-modal="true"
              onClick={() => setScheduleOpen(false)}
            >
              <div
                className="sms-drawer sms-drawer--modern"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="sms-drawer__header">
                  <span className="sms-drawer__title">SMS định kỳ đang bị khóa</span>

                  <button
                    className="sms-drawer__close"
                    onClick={() => setScheduleOpen(false)}
                    aria-label="Đóng"
                  >
                    ×
                  </button>
                </div>

                <div className="sms-drawer__body">
                  <div className="uf-basic-card">
                    <b>Chưa kích hoạt SMS định kỳ.</b>
                    <span>
                      Vui lòng nhập mã gói SMS định kỳ có feature sms_schedule.
                      Sau khi kích hoạt thành công, nút SMS định kỳ sẽ tự mở.
                    </span>
                  </div>

                  <RedeemCodeForm />
                </div>
              </div>
            </div>
          }
        >
          <div
            className="sms-drawer-backdrop"
            role="dialog"
            aria-modal="true"
            onClick={() => setScheduleOpen(false)}
          >
            <div
              className="sms-drawer sms-drawer--modern"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sms-drawer__header">
                <span className="sms-drawer__title">SMS định kỳ</span>

                <button
                  className="sms-drawer__close"
                  onClick={() => setScheduleOpen(false)}
                  aria-label="Đóng"
                >
                  ×
                </button>
              </div>

              <div className="sms-drawer__body">
                <ScheduledSmsSettingsPage />
              </div>
            </div>
          </div>
        </FeatureGate>
      )}

      {/* Drawer cài ngưỡng cảnh báo */}
      {thresholdOpen && (
        <div
          className="sms-drawer-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => setThresholdOpen(false)}
        >
          <div
            className="sms-drawer sms-drawer--modern threshold-drawer"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sms-drawer__header">
              <span className="sms-drawer__title">Cài ngưỡng cảnh báo</span>

              <button
                className="sms-drawer__close"
                onClick={() => setThresholdOpen(false)}
                aria-label="Đóng"
              >
                ×
              </button>
            </div>

            <div className="sms-drawer__body threshold-drawer__body">
              <UserAlertThresholds />
            </div>
          </div>
        </div>
      )}

      {/* Drawer đặt tên thiết bị */}
      {deviceNamesOpen && (
        <div
          className="sms-drawer-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => setDeviceNamesOpen(false)}
        >
          <div
            className="sms-drawer sms-drawer--modern"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sms-drawer__header">
              <span className="sms-drawer__title">Đặt tên thiết bị</span>

              <button
                className="sms-drawer__close"
                onClick={() => setDeviceNamesOpen(false)}
                aria-label="Đóng"
              >
                ×
              </button>
            </div>

            <div className="sms-drawer__body">
              <UserDeviceNames />
            </div>
          </div>
        </div>
      )}

      <MonthlyReportModal
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        defaultEmail={(user as any)?.email || ""}
      />

      <AlarmModal
        visible={alarmAPI.modalOpen}
        onClose={alarmAPI.closeModal}
        alarms={alarmAPI.alarms}
        addAlarm={alarmAPI.addAlarm}
        removeAlarm={alarmAPI.removeAlarm}
        toggleAlarm={alarmAPI.toggleAlarm}
        stopRinging={alarmAPI.stopRinging}
        ringRepeatCount={alertRepeatCount}
      />

      {toasts.length > 0 && (
        <div
          className="uft-toast-stack"
          role="region"
          aria-live="assertive"
        >
          {toasts.filter(isTodayAlert).map((t) => {
            const typ = parseAlertType(t.message);
            const key = alertKey(t);

            const cls =
              typ === "power_loss"
                ? "uf-toast--danger"
                : typ === "power_restore"
                  ? "uf-toast--ok"
                  : getSeverity(t) === "critical"
                    ? "uf-toast--critical"
                    : "uf-toast--warning";

            return (
              <article className={`uft-alert-card ${cls}`} key={key}>
                <div className="uft-alert-mark" aria-hidden="true">
                  {typ === "power_loss"
                    ? "⚡"
                    : typ === "power_restore"
                      ? "✓"
                      : "🌡️"}
                </div>

                <div className="uft-alert-body">
                  <div className="uft-alert-topline">
                    <span className="uft-alert-badge">{getAlertLabel(typ)}</span>
                    <time className="uft-alert-time">{formatDateTime(t.timeUtc)}</time>
                  </div>

                  <h4 className="uft-alert-title">{t.message}</h4>

                  <div className="uft-alert-meta">
                    <span>{t.serialNumber}</span>
                    <span>{t.notes || "Không có ghi chú"}</span>
                  </div>

                  <div className="uft-alert-actions">
                    <button
                      type="button"
                      className="uft-alert-btn uft-alert-btn-primary"
                      onClick={() => navigate("/events")}
                    >
                      Xem sự kiện
                    </button>

                    <button
                      type="button"
                      className="uft-alert-btn uft-alert-btn-ghost"
                      onClick={() => {
                        setToasts((prev) =>
                          prev.filter((x) => alertKey(x) !== key),
                        );
                        stopCurrentAlertSound();
                      }}
                    >
                      Đóng
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default User;