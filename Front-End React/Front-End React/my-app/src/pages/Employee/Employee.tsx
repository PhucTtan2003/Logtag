import "../../styles/Employee/Employee.css";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Bell,
  LogOut,
  Menu,
  X,
  Gauge,
  BarChart2,
  ThermometerSun,
  ClipboardList,
  Wifi,
  WifiOff,
  ShieldCheck,
} from "lucide-react";

import { useAuth } from "../../contexts/AuthContext";
import { useEmployeeLogic } from "../../hooks/useEmployeeLogic";

import WarrantyPopup from "../../components/Warranty/WarrantyPopup";
import NotificationPopup from "../../components/Notification/NotificationPopup";
import EmployeeInfoCards from "../../components/EmployeeInfoCards";
import TaskList from "../../components/TaskList";

import ChartBox from "../../components/Chart/ChartBox";
import api from "../../api/axios";

import { getLogTagConnection, ensureStarted } from "../../realtime/logtaghub";

/* ================= Types ================= */
type LiveStatusDto = {
  serialNumber: string;
  notes?: string | null;
  status: string;
  temperature?: number | null;
  humidity?: number | null;
  timeUtc?: string | Date | null;
};

type LiveAlertDto = {
  serialNumber: string;
  notes?: string | null;
  message: string;
  timeUtc: string | Date;
};

type AlertType =
  | "temperature_high"
  | "temperature_low"
  | "power_loss"
  | "power_restore"
  | "battery_low"
  | "other";

/* ================= Helpers ================= */
const parseAlertType = (msg: string): AlertType => {
  const m = (msg || "").toLowerCase();

  if (m.includes("power loss") || m.includes("mất nguồn")) return "power_loss";
  if (
    m.includes("power restored") ||
    (m.includes("khôi phục") && m.includes("nguồn"))
  )
    return "power_restore";
  if (
    (m.includes("battery") && m.includes("low")) ||
    (m.includes("pin") && (m.includes("yếu") || m.includes("thấp")))
  )
    return "battery_low";

  if (m.includes("temperature") && m.includes("alarm")) {
    if (m.includes("high") || m.includes("vượt ngưỡng"))
      return "temperature_high";
    if (m.includes("low")) return "temperature_low";
    return "temperature_high";
  }
  return "other";
};

const getSeverity = (a: LiveAlertDto) => {
  const typ = parseAlertType(a.message);
  if (
    typ === "power_loss" ||
    typ === "temperature_high" ||
    typ === "battery_low"
  )
    return "critical";
  if (typ === "temperature_low") return "warning";
  if (typ === "power_restore") return "info";
  return "warning";
};

const toArray = <T,>(x: any): T[] =>
  x == null ? [] : Array.isArray(x) ? x : [x];

const mergeStatuses = (prev: LiveStatusDto[], incoming: LiveStatusDto[]) => {
  const byId = new Map(prev.map((d) => [d.serialNumber, d]));
  for (const it of incoming) {
    const old = (byId.get(it.serialNumber) as any) ?? {};
    byId.set(it.serialNumber, { ...old, ...it });
  }
  return Array.from(byId.values()).sort((a, b) => {
    const ta = a.timeUtc ? new Date(a.timeUtc).getTime() : 0;
    const tb = b.timeUtc ? new Date(b.timeUtc).getTime() : 0;
    return tb - ta;
  });
};

function mapStatusPayload(arr: any[]): LiveStatusDto[] {
  return (arr ?? []).map((x) => ({
    serialNumber: x.serialNumber ?? x.SerialNumber ?? x.name ?? "",
    notes: x.notes ?? x.Notes ?? null,
    status: x.status ?? x.Status ?? "Unknown",
    temperature: x.temperature ?? x.Temperature ?? null,
    humidity: x.humidity ?? x.Humidity ?? null,
    timeUtc: x.timeUtc ?? x.TimeUtc ?? x.time ?? x.Time ?? null,
  }));
}

function mapAlertPayload(arr: any[]): LiveAlertDto[] {
  return (arr ?? []).map((x) => ({
    serialNumber: x.serialNumber ?? x.SerialNumber ?? "",
    notes: x.notes ?? x.Notes ?? null,
    message: x.message ?? x.Message ?? "",
    timeUtc:
      x.timeUtc ?? x.TimeUtc ?? x.time ?? x.Time ?? new Date().toISOString(),
  }));
}

// Ưu tiên userId/uid; nếu không có thì fallback sang accountId
const getUserIdHeader = () => {
  const uid =
    localStorage.getItem("userId") ||
    localStorage.getItem("uid") ||
    localStorage.getItem("accountId") ||
    "";
  return uid ? { "X-User-Id": uid } : {};
};

// GET có retry & tôn trọng 429
async function getWithRetry(url: string, config: any, maxAttempts = 3) {
  let attempt = 0;
  const MIN_SPACING_MS = 1100;
  let last = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const now = Date.now();
    const elapsed = now - last;
    if (elapsed < MIN_SPACING_MS) {
      await new Promise((r) => setTimeout(r, MIN_SPACING_MS - elapsed));
    }
    try {
      const res = await api.get(url, config);
      return res;
    } catch (err: any) {
      const status = err?.response?.status;
      const ra = Number(err?.response?.headers?.["retry-after"] || 0);
      if (status === 429 && attempt + 1 < maxAttempts) {
        const waitMs =
          (ra > 0 ? ra * 1000 : 1000) + Math.floor(Math.random() * 250);
        await new Promise((r) => setTimeout(r, waitMs));
        attempt++;
        last = Date.now();
        continue;
      }
      throw err;
    }
  }
}

/* ================= Component ================= */
type EmpSection =
  | "dashboard"
  | "chart"
  | "thresholds"
  | "tasks"
  | "notifications";

const Employee: React.FC = () => {
  const API_URL = (process.env.REACT_APP_API_BASE_URL || "").replace(
    /\/+$/,
    "",
  );
  const accountId = localStorage.getItem("accountId") || "";
  const { logout } = useAuth();

  // 👉 ID dùng để so sánh quyền sở hữu task (ưu tiên userId/uid)
  const compareId =
    localStorage.getItem("userId") ||
    localStorage.getItem("uid") ||
    accountId ||
    "";

  // ===== Logic chung (thông báo, hồ sơ, warranty…) =====
  const {
    notifications,
    isOpen,
    unreadCount,
    warrantyList,
    setWarrantyList,
    unseenWarrantyCount,
    togglePopup,
    handleMarkAsRead,
    handleMarkAllAsRead,
    handleOpenWarranties,
    handleMarkedSeen,
    handleUpdateStatus,
    employeeInfo,
  } = useEmployeeLogic(accountId);

  // ===== Danh sách thiết bị của tôi (để ChartBox chỉ cho chọn trong phạm vi user) =====
  const [mySerials, setMySerials] = useState<string[]>([]);
  const [defaultSerial, setDefaultSerial] = useState<string | undefined>(
    undefined,
  );
  const [isLoadingSerials, setIsLoadingSerials] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers = { ...getUserIdHeader() };
        if (!headers["X-User-Id"]) {
          console.warn(
            "[Employee] Thiếu X-User-Id trong localStorage (userId/uid/accountId).",
          );
        }
        const res = await getWithRetry(`/api/sensordata/GetDeviceSerials`, {
          headers,
        });
        const list = Array.isArray(res.data) ? (res.data as string[]) : [];
        if (!cancelled) {
          setMySerials(list);
          setDefaultSerial(list[0]); // auto chọn sẵn 1 thiết bị đầu
        }
        if (!list.length) {
          console.warn(
            "[Employee] Danh sách thiết bị trống cho user hiện tại.",
          );
        }
      } catch (e) {
        console.warn("[Employee] Không load được danh sách thiết bị (All).", e);
        if (!cancelled) {
          setMySerials([]);
          setDefaultSerial(undefined);
        }
      } finally {
        if (!cancelled) setIsLoadingSerials(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ===== Realtime cho InfoCards/Alerts — DÙNG HUB SINGLETON =====
  const [realtimeData, setRealtimeData] = useState<LiveStatusDto[]>([]);
  const [realtimeAlerts, setRealtimeAlerts] = useState<LiveAlertDto[]>([]);
  const [hubOnline, setHubOnline] = useState<boolean>(false);

  // ======= 🔊 + Toast/Banner state cho EMPLOYEE =======
  const alarmRef = useRef<HTMLAudioElement | null>(null);
  const powerLossRef = useRef<HTMLAudioElement | null>(null);
  const [soundEnabled] = useState(true);

  const [toasts, setToasts] = useState<LiveAlertDto[]>([]);
  const [recentAlert, setRecentAlert] = useState<LiveAlertDto | null>(null);
  const [recentVisible, setRecentVisible] = useState(false);
  const alertKey = (a: LiveAlertDto) =>
    `${a.serialNumber}|${a.message}|${a.timeUtc}`;

  // ✅ Helper dừng tiếng alert hiện tại
  const stopCurrentAlertSound = useCallback(() => {
    try {
      if (powerLossRef.current) {
        powerLossRef.current.pause();
        powerLossRef.current.currentTime = 0;
      }
      if (alarmRef.current) {
        alarmRef.current.pause();
        alarmRef.current.currentTime = 0;
      }
    } catch {
      // ignore
    }
  }, []);

  // Snapshot từ REST => dùng API my-status + my-alerts
  const fetchSnapshot = useCallback(async () => {
    if (!accountId || !/^[a-f\d]{24}$/i.test(accountId)) return;

    const qsStatus = new URLSearchParams({ accountId, limit: "50" }).toString();
    const qsAlerts = new URLSearchParams({
      accountId,
      hours: "24",
      limit: "100",
    }).toString();

    const statusUrl = `${API_URL}/api/logtag/my-status?${qsStatus}`;
    const alertsUrl = `${API_URL}/api/logtag/my-alerts?${qsAlerts}`;

    const ctrl = new AbortController();
    const { signal } = ctrl;
    let unmounted = false;

    const commonInit: RequestInit = {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      signal,
      headers: { Accept: "application/json" },
    };

    try {
      const [stRes, alRes] = await Promise.all([
        fetch(statusUrl, commonInit),
        fetch(alertsUrl, commonInit),
      ]);

      if (stRes.ok) {
        const stJson = await stRes.json();
        const mapped = mapStatusPayload(toArray<LiveStatusDto>(stJson));
        if (!unmounted && mapped.length) {
          setRealtimeData((prev) => mergeStatuses(prev, mapped));
        }
      } else {
        const body = await stRes.text().catch(() => "");
        console.warn(
          "[snapshot] my-status !ok",
          stRes.status,
          stRes.statusText,
          body || "(no body)",
        );
      }

      if (alRes.ok) {
        const alJson = await alRes.json();
        const mappedAl = mapAlertPayload(toArray<LiveAlertDto>(alJson));
        if (!unmounted && mappedAl.length) {
          setRealtimeAlerts((prev) => [...prev, ...mappedAl].slice(-200));
        }
      } else {
        const body = await alRes.text().catch(() => "");
        console.warn(
          "[snapshot] my-alerts !ok",
          alRes.status,
          alRes.statusText,
          body || "(no body)",
        );
      }
    } catch (e) {
      console.warn("Snapshot error:", e);
    }

    return () => {
      unmounted = true;
      ctrl.abort();
    };
  }, [API_URL, accountId]);

  // Khởi tạo hub + handlers
  useEffect(() => {
    if (!/^[a-f\d]{24}$/i.test(accountId)) {
      if (accountId) console.warn("❌ accountId không hợp lệ:", accountId);
      return;
    }
    if (!API_URL) {
      console.warn("❌ API_URL rỗng.");
      return;
    }

    const tokenFactory = () =>
      localStorage.getItem("userId") ||
      localStorage.getItem("uid") ||
      accountId ||
      "";

    let cleanup: (() => void) | undefined;

    (async () => {
      try {
        // ✅ Lấy hub singleton + đảm bảo đã start
        const hub = getLogTagConnection(`${API_URL}/hub/logtag`, tokenFactory);
        await ensureStarted(hub);
        setHubOnline(true);

        // Tránh gắn trùng handlers (StrictMode/mount lại)
        hub.off("ReceiveStatusUpdate");
        hub.off("ReceiveAlert");

        const onStatus = (data: any) => {
          const mapped = mapStatusPayload(toArray<LiveStatusDto>(data));
          if (mapped.length)
            setRealtimeData((prev) => mergeStatuses(prev, mapped));
        };

        // ⭐ EMPLOYEE: toast + banner + âm thanh
        const onAlert = (alerts: any) => {
          const mapped = mapAlertPayload(toArray<LiveAlertDto>(alerts));
          if (!mapped.length) return;

          // lưu cho InfoCards
          setRealtimeAlerts((prev) => [...prev, ...mapped].slice(-200));

          // key đã bấm "Đã hiểu" gần nhất -> không phát âm/bật banner lại cho cùng key
          const dismissedKey =
            sessionStorage.getItem("emp_recentAlertDismissedKey") || "";

          // Chỉ phát âm **1 lần** cho cả batch
          let playedThisBatch = false;

          for (const a of mapped) {
            const key = `${a.serialNumber}|${a.message}|${a.timeUtc}`;
            const isDismissed = key === dismissedKey;

            // 🔊 Âm thanh (bỏ qua nếu đã "Đã hiểu" cho key này)
            if (!isDismissed && soundEnabled && !playedThisBatch) {
              const typ = parseAlertType(a.message);
              try {
                if (typ === "power_loss" && powerLossRef.current) {
                  powerLossRef.current.currentTime = 0;
                  powerLossRef.current.play().catch(() => {});
                  playedThisBatch = true;
                } else if (
                  (typ === "temperature_high" ||
                    typ === "temperature_low" ||
                    typ === "battery_low") &&
                  alarmRef.current
                ) {
                  alarmRef.current.currentTime = 0;
                  alarmRef.current.play().catch(() => {});
                  playedThisBatch = true;
                }
              } catch {
                // ignore
              }
            }

            // 🔔 Toast
            setToasts((prev) => [a, ...prev].slice(0, 5));
            setTimeout(() => {
              setToasts((prev) => prev.slice(0, Math.max(prev.length - 1, 0)));
            }, 6000);

            // 📌 Banner: chỉ bật nếu chưa bị dismiss cho đúng key
            try {
              if (!isDismissed) {
                setRecentAlert(a);
                setRecentVisible(true);
                sessionStorage.setItem("emp_recentAlert", JSON.stringify(a));
                sessionStorage.setItem("emp_recentAlertKey", key);
              }
            } catch {
              // ignore
            }
          }
        };

        hub.on("ReceiveStatusUpdate", onStatus);
        hub.on("ReceiveAlert", onAlert);

        // Reconnected => refresh snapshot
        const onReconnected = () => {
          setHubOnline(true);
          fetchSnapshot();
        };
        const onClosed = () => setHubOnline(false);

        // @ts-ignore: tùy SignalR version
        if (typeof (hub as any).onreconnected === "function")
          (hub as any).onreconnected(onReconnected);
        // @ts-ignore
        if (typeof (hub as any).onclose === "function")
          (hub as any).onclose(onClosed);

        // ✅ Không stop hub khi unmount; chỉ off handlers
        cleanup = () => {
          try {
            hub.off("ReceiveStatusUpdate", onStatus);
          } catch {}
          try {
            hub.off("ReceiveAlert", onAlert);
          } catch {}
        };

        // Lấy snapshot ban đầu
        fetchSnapshot();
      } catch (err) {
        console.error("❌ Không thể dùng hub singleton cho Employee:", err);
        setHubOnline(false);
        cleanup = undefined;
      }
    })();

    return () => {
      if (cleanup) cleanup();
    };
  }, [API_URL, accountId, fetchSnapshot, soundEnabled]);

  // Khôi phục banner chưa dismiss (sau reload)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("emp_recentAlert");
      const key = sessionStorage.getItem("emp_recentAlertKey");
      const dismissedKey = sessionStorage.getItem(
        "emp_recentAlertDismissedKey",
      );
      if (raw && key && key !== dismissedKey) {
        const a = JSON.parse(raw) as LiveAlertDto;
        if (a && typeof a === "object") {
          setRecentAlert(a);
          setRecentVisible(true);
        }
      }
    } catch {}
  }, []);

  // ===== Đóng popup thông báo khi click ra ngoài =====
  const notifWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!isOpen) return;
      if (
        notifWrapRef.current &&
        !notifWrapRef.current.contains(event.target as Node)
      ) {
        togglePopup();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, togglePopup]);

  // ===================== 🌡️ THRESHOLDS (EMPLOYEE) =====================
  const [thSerial, setThSerial] = useState<string>("");
  const [thUpper, setThUpper] = useState<string>("");
  const [thLower, setThLower] = useState<string>("");
  const [thLoading, setThLoading] = useState<boolean>(false);
  const [thMsg, setThMsg] = useState<string>("");

  // auto chọn mặc định theo defaultSerial
  useEffect(() => {
    if (!thSerial && defaultSerial) setThSerial(defaultSerial);
  }, [defaultSerial, thSerial]);

  const loadMyThreshold = async () => {
    setThMsg("");
    const serial = (thSerial || "").trim();
    if (!serial) {
      setThMsg("Chọn Serial trước.");
      return;
    }
    // chặn ngoài phạm vi user
    if (mySerials.length && !mySerials.includes(serial)) {
      setThMsg(
        "Bạn chỉ có thể xem/sửa ngưỡng của thiết bị thuộc quyền của bạn.",
      );
      return;
    }

    setThLoading(true);
    try {
      const { data: res } = await api.get(
        `/api/alert-thresholds/v1/${encodeURIComponent(serial)}`,
        {
          headers: { ...getUserIdHeader() },
        },
      );
      const d = res?.data ?? {};
      const up = d?.upperThreshold == null ? "" : String(d.upperThreshold);
      const lo = d?.lowerThreshold == null ? "" : String(d.lowerThreshold);
      setThUpper(up);
      setThLower(lo);
      setThMsg("Đã tải cấu hình hiện tại.");
    } catch (err: any) {
      if (err?.response?.status === 404) {
        setThUpper("");
        setThLower("");
        setThMsg("Chưa có cấu hình cho serial này.");
      } else {
        setThMsg(
          `Không tải được cấu hình.${err?.message ? " " + String(err.message) : ""}`,
        );
      }
    } finally {
      setThLoading(false);
    }
  };

  const saveMyThreshold = async () => {
    const serial = (thSerial || "").trim();
    if (!serial) {
      setThMsg("Chọn Serial trước.");
      return;
    }
    if (mySerials.length && !mySerials.includes(serial)) {
      setThMsg("Bạn chỉ có thể lưu ngưỡng cho thiết bị thuộc quyền của bạn.");
      return;
    }

    const up =
      thUpper === ""
        ? null
        : Number.isFinite(Number(thUpper))
          ? Number(thUpper)
          : NaN;
    const lo =
      thLower === ""
        ? null
        : Number.isFinite(Number(thLower))
          ? Number(thLower)
          : NaN;

    if (Number.isNaN(up) || Number.isNaN(lo)) {
      setThMsg("Giá trị ngưỡng không hợp lệ.");
      return;
    }

    setThLoading(true);
    setThMsg("");
    try {
      await api.put(
        `/api/alert-thresholds/v1`,
        {
          serialNumber: serial,
          upperThreshold: up,
          lowerThreshold: lo,
        },
        { headers: { ...getUserIdHeader() } },
      );
      setThMsg("Đã lưu ngưỡng.");
    } catch (err: any) {
      setThMsg(
        `Lưu thất bại.${err?.response?.status ? ` (HTTP ${err.response.status})` : ""}${
          err?.message ? " " + String(err.message) : ""
        }`,
      );
    } finally {
      setThLoading(false);
    }
  };

  // ===== Loading flag
  const isLoadingAccount = !accountId;

  // === Sidebar & Sections ===
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<EmpSection>("dashboard");
  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);

  // ESC để đóng sidebar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hasActive = !!recentAlert && recentVisible;
  const bannerType = hasActive ? parseAlertType(recentAlert!.message) : "other";
  const bannerSeverity = hasActive ? getSeverity(recentAlert!) : "info";

  // Sidebar item helper
  const SbItem: React.FC<{
    id: EmpSection;
    icon: React.ReactNode;
    label: string;
  }> = ({ id, icon, label }) => (
    <button
      type="button"
      onClick={() => {
        setActiveSection(id);
        setSidebarOpen(false);
      }}
      className={`emp-sb_item ${activeSection === id ? "is-active" : ""}`}
    >
      <span className="emp-sb_icon">{icon}</span>
      <span>{label}</span>
    </button>
  );

  // ========= Quick Tabs (trên header) =========
  const QuickTab: React.FC<{
    id: EmpSection;
    icon: React.ReactNode;
    label: string;
  }> = ({ id, icon, label }) => (
    <button
      className={`quick-tab ${activeSection === id ? "active" : ""}`}
      onClick={() => setActiveSection(id)}
      type="button"
      aria-pressed={activeSection === id}
    >
      <span className="qt-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );

  // ========= Quick Select (thiết bị) =========
  const QuickDeviceSelect = () => (
    <div className="quick-device">
      <ShieldCheck size={16} />
      {isLoadingSerials ? (
        <span className="skeleton-pill" style={{ width: 120 }} />
      ) : mySerials.length ? (
        <select
          value={defaultSerial || ""}
          onChange={(e) => {
            setDefaultSerial(e.target.value || undefined);
            if (activeSection !== "chart") setActiveSection("chart");
          }}
          aria-label="Thiết bị mặc định"
        >
          {mySerials.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      ) : (
        <span className="empty-pill">Chưa có thiết bị</span>
      )}
    </div>
  );

  const serialStatusMap = new Map(
    realtimeData.map((d) => [String(d.serialNumber || "").toUpperCase(), d]),
  );

  const onlineCount = realtimeData.filter((d) =>
    String(d.status || "")
      .toLowerCase()
      .includes("online"),
  ).length;

  const criticalAlertCount = realtimeAlerts.filter(
    (a) => getSeverity(a) === "critical",
  ).length;
  const latestReading = realtimeData.find(
    (d) => d.temperature != null || d.humidity != null,
  );
  const employeeName =
    String(
      (employeeInfo as any)?.fullName ||
        (employeeInfo as any)?.name ||
        (employeeInfo as any)?.username ||
        "Employee",
    ).trim() || "Employee";

  const sectionTitle: Record<EmpSection, string> = {
    dashboard: "Tổng quan vận hành",
    chart: "Biểu đồ thiết bị",
    thresholds: "Ngưỡng cảnh báo",
    tasks: "Công việc hôm nay",
    notifications: "Trung tâm thông báo",
  };

  const formatTime = (v?: string | Date | null) => {
    if (!v) return "Chưa có dữ liệu";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "Chưa có dữ liệu";
    return d.toLocaleString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
    });
  };

  const Metric3D: React.FC<{
    label: string;
    value: React.ReactNode;
    hint: string;
    icon: React.ReactNode;
    tone?: "blue" | "green" | "amber" | "red";
  }> = ({ label, value, hint, icon, tone = "blue" }) => (
    <div className={`emp3d-metric emp3d-metric--${tone}`}>
      <div className="emp3d-metric__icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{hint}</small>
      </div>
    </div>
  );

  const DeviceMiniCard: React.FC<{ serial: string }> = ({ serial }) => {
    const d = serialStatusMap.get(serial.toUpperCase());
    const isOnline = String(d?.status || "")
      .toLowerCase()
      .includes("online");

    return (
      <button
        type="button"
        className={`emp3d-device-card ${defaultSerial === serial ? "is-selected" : ""}`}
        onClick={() => {
          setDefaultSerial(serial);
          setActiveSection("chart");
        }}
        title="Mở biểu đồ thiết bị"
      >
        <span
          className={`emp3d-device-dot ${isOnline ? "online" : "offline"}`}
        />
        <span className="emp3d-device-main">
          <strong>{serial}</strong>
          <small>{d?.notes || d?.status || "Thiết bị của tôi"}</small>
        </span>
        <span className="emp3d-device-temp">
          {d?.temperature == null
            ? "--"
            : `${Number(d.temperature).toFixed(1)}°C`}
        </span>
      </button>
    );
  };

  return (
    <div className="employee-dashboard emp3d-shell">
      <div className="emp3d-bg" aria-hidden="true">
        <span className="emp3d-orb emp3d-orb--one" />
        <span className="emp3d-orb emp3d-orb--two" />
        <span className="emp3d-grid" />
      </div>

      {/* ===== Sidebar Drawer ===== */}
      <aside
        role="navigation"
        aria-label="Employee Sidebar"
        className={`emp-sidebar emp3d-sidebar ${sidebarOpen ? "open" : ""}`}
      >
        <div className="emp-sb_head emp3d-sidebar__head">
          <div className="emp3d-side-brand">
            <img src="/Pictures/logo.png" alt="SmartTech" />
            <div>
              <strong>SmartTech</strong>
              <small>Employee Console</small>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            aria-label="Đóng"
            className="icon-btn emp3d-icon-btn"
          >
            <X size={18} />
          </button>
        </div>

        <div className="emp3d-user-card">
          <div className="emp3d-avatar">
            {employeeName.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <strong>{employeeName}</strong>
            <small>
              {hubOnline ? "Realtime đang kết nối" : "Đang chờ realtime"}
            </small>
          </div>
        </div>

        <div className="emp-sb_body emp3d-nav">
          <SbItem id="dashboard" icon={<Gauge size={16} />} label="Tổng quan" />
          <SbItem id="chart" icon={<BarChart2 size={16} />} label="Biểu đồ" />
          <SbItem
            id="thresholds"
            icon={<ThermometerSun size={16} />}
            label="Ngưỡng cảnh báo"
          />
          <SbItem
            id="tasks"
            icon={<ClipboardList size={16} />}
            label="Công việc"
          />
          <SbItem
            id="notifications"
            icon={<Bell size={16} />}
            label="Thông báo"
          />
        </div>

        <div className="emp-sb_footer emp3d-sidebar__footer">
          <span>{mySerials.length} thiết bị được gán</span>
          <small>SMARTTECH • 3D UI</small>
        </div>
      </aside>

      {sidebarOpen && (
        <div
          className="emp-overlay emp3d-overlay"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <button
        type="button"
        className="floating-menu-btn emp3d-floating-menu"
        aria-label={sidebarOpen ? "Đóng menu" : "Mở menu"}
        aria-pressed={sidebarOpen}
        onClick={toggleSidebar}
      >
        {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
      </button>

      <audio ref={alarmRef} src="/alarm.mp3" preload="auto" />
      <audio ref={powerLossRef} src="/turnof.mp3" preload="auto" />

      <div className="emp3d-layout">
        {/* ===== Header / Hero ===== */}
        <header
          className="employee-header emp3d-hero"
          role="banner"
          aria-label="Employee Header"
        >
          <div className="emp3d-hero__content">
            <div className="header-left emp3d-brand-row">
              <img
                src="/Pictures/logo.png"
                alt="SmartTech Logo"
                className="brand-logo emp3d-logo"
              />
              <div className="brand-titles">
                <span className="emp3d-eyebrow">SMARTTECH EMPLOYEE SPACE</span>
                <h1>
                  Xin chào, <span>{employeeName}</span>
                </h1>
                <small className="muted">
                  Giao diện vận hành mới dạng 3D/glass – theo dõi thiết bị, cảnh
                  báo và công việc nhanh hơn.
                </small>
              </div>
            </div>

            <div className="emp3d-hero__actions">
              <div
                className={`hub-chip emp3d-hub-chip ${hubOnline ? "ok" : "down"}`}
              >
                {hubOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
                <span>{hubOnline ? "Realtime Online" : "Offline"}</span>
              </div>

              <QuickDeviceSelect />

              <div
                className="notification-wrap emp3d-notification-wrap"
                ref={notifWrapRef}
              >
                <div className="header-actions emp3d-header-actions">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePopup();
                    }}
                    className="notification-btn emp3d-round-btn"
                    aria-label="Thông báo"
                    title="Thông báo"
                  >
                    <Bell size={18} />
                    {unreadCount > 0 && (
                      <span className="badge emp3d-badge">{unreadCount}</span>
                    )}
                  </button>
                  <button
                    onClick={() => void logout("/")}
                    className="logout-btn emp3d-logout"
                    title="Đăng xuất"
                  >
                    <LogOut size={14} />{" "}
                    <span className="logout-text">Đăng xuất</span>
                  </button>
                </div>

                <NotificationPopup
                  notifications={notifications}
                  isOpen={isOpen}
                  onMarkAsRead={handleMarkAsRead}
                  onMarkAllAsRead={handleMarkAllAsRead}
                />
              </div>
            </div>
          </div>

          <div className="emp3d-metrics-row">
            <Metric3D
              label="Thiết bị"
              value={mySerials.length}
              hint={
                isLoadingSerials
                  ? "Đang tải danh sách"
                  : `${onlineCount}/${mySerials.length || 0} đang online`
              }
              icon={<ShieldCheck size={18} />}
              tone="blue"
            />
            <Metric3D
              label="Nhiệt độ mới nhất"
              value={
                latestReading?.temperature == null
                  ? "--"
                  : `${Number(latestReading.temperature).toFixed(1)}°C`
              }
              hint={
                latestReading
                  ? formatTime(latestReading.timeUtc)
                  : "Chưa có reading"
              }
              icon={<ThermometerSun size={18} />}
              tone="green"
            />
            <Metric3D
              label="Cảnh báo"
              value={criticalAlertCount}
              hint={`${realtimeAlerts.length} cảnh báo trong bộ nhớ`}
              icon={<Bell size={18} />}
              tone={criticalAlertCount > 0 ? "red" : "amber"}
            />
          </div>
        </header>

        <div
          className="quick-tabs emp3d-tabs"
          role="tablist"
          aria-label="Employee sections"
        >
          <QuickTab
            id="dashboard"
            icon={<Gauge size={14} />}
            label="Tổng quan"
          />
          <QuickTab id="chart" icon={<BarChart2 size={14} />} label="Biểu đồ" />
          <QuickTab
            id="thresholds"
            icon={<ThermometerSun size={14} />}
            label="Ngưỡng"
          />
          <QuickTab
            id="tasks"
            icon={<ClipboardList size={14} />}
            label="Công việc"
          />
          <QuickTab
            id="notifications"
            icon={<Bell size={14} />}
            label="Thông báo"
          />
        </div>

        {isLoadingAccount && (
          <div className="page-loader emp3d-loader">
            <div className="skeleton-line" />
            <div className="skeleton-line" />
            <div className="skeleton-line short" />
          </div>
        )}

        {/* ===== STATUS BANNER ===== */}
        {hasActive ? (
          <div
            className={
              `recent-banner emp3d-alert-banner ` +
              (bannerSeverity === "critical"
                ? "recent-banner--critical"
                : bannerSeverity === "warning"
                  ? "recent-banner--warning"
                  : "recent-banner--info") +
              (bannerType === "power_loss" ? " recent-banner--poweroff" : "")
            }
            role="status"
            aria-live="assertive"
          >
            <div className="recent-banner__left">
              <span
                className={
                  `recent-badge ` +
                  (bannerType === "power_loss"
                    ? "recent-badge--danger"
                    : bannerType === "power_restore"
                      ? "recent-badge--ok"
                      : "")
                }
              >
                {bannerType === "power_loss"
                  ? "Mất nguồn"
                  : bannerType === "power_restore"
                    ? "Nguồn đã khôi phục"
                    : "Thông báo"}
              </span>
              <div className="recent-banner__title">
                {recentAlert!.message}
                <span className="recent-banner__serial">
                  • {recentAlert!.serialNumber}
                </span>
              </div>
              <div className="recent-banner__desc">
                {recentAlert!.notes || "—"}
              </div>
            </div>
            <div className="recent-banner__actions">
              <button
                className="btn emp3d-primary-btn"
                onClick={() => {
                  const key = alertKey(recentAlert!);
                  sessionStorage.setItem("emp_recentAlertDismissedKey", key);
                  setRecentVisible(false);
                  stopCurrentAlertSound();
                }}
              >
                Đã hiểu
              </button>
            </div>
          </div>
        ) : null}

        {/* ===== Main ===== */}
        <main className="employee-main emp3d-main">
          <section className="emp3d-section-top">
            <div>
              <span className="emp3d-eyebrow">
                {activeSection.toUpperCase()}
              </span>
              <h2>{sectionTitle[activeSection]}</h2>
            </div>
            <div className="emp3d-section-chip">
              {hubOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
              <span>
                {hubOnline
                  ? "Dữ liệu đang đồng bộ"
                  : "Đang mất kết nối realtime"}
              </span>
            </div>
          </section>

          {activeSection === "dashboard" && (
            <div className="emp3d-dashboard-grid">
              <section className="emp3d-glass-card emp3d-card--wide">
                <div className="emp3d-card-head">
                  <div>
                    <span className="emp3d-eyebrow">OVERVIEW</span>
                    <h3>Tổng quan tài khoản & thiết bị</h3>
                  </div>
                  <button
                    type="button"
                    className="emp3d-soft-btn"
                    onClick={() => setActiveSection("chart")}
                  >
                    Xem biểu đồ
                  </button>
                </div>
                <EmployeeInfoCards
                  employeeInfo={employeeInfo}
                  onOpenWarranties={handleOpenWarranties}
                  unseenWarrantyCount={unseenWarrantyCount}
                  realtimeData={realtimeData}
                  realtimeAlerts={realtimeAlerts}
                />
              </section>

              <aside className="emp3d-glass-card emp3d-device-panel">
                <div className="emp3d-card-head compact">
                  <div>
                    <span className="emp3d-eyebrow">MY DEVICES</span>
                    <h3>Thiết bị nhanh</h3>
                  </div>
                  <span className="chip-outline emp3d-chip-outline">
                    {mySerials.length}
                  </span>
                </div>

                <div className="emp3d-device-list">
                  {isLoadingSerials ? (
                    <>
                      <span className="skeleton-pill" />
                      <span className="skeleton-pill" />
                      <span className="skeleton-pill" />
                    </>
                  ) : mySerials.length ? (
                    mySerials
                      .slice(0, 8)
                      .map((s) => <DeviceMiniCard key={s} serial={s} />)
                  ) : (
                    <div className="empty-state emp3d-empty-mini">
                      <p>Chưa có thiết bị nào được gán cho tài khoản này.</p>
                    </div>
                  )}
                </div>
              </aside>
            </div>
          )}

          {activeSection === "chart" && (
            <section
              className="chart-section emp3d-glass-card emp3d-chart-card"
              aria-label="Biểu đồ thiết bị của tôi"
            >
              <div className="section-head emp3d-card-head">
                <div>
                  <span className="emp3d-eyebrow">TEMPERATURE & HUMIDITY</span>
                  <h2>📊 Biểu đồ thiết bị của tôi</h2>
                </div>
                {defaultSerial && (
                  <div className="chip-outline emp3d-chip-outline">
                    Serial: {defaultSerial}
                  </div>
                )}
              </div>

              <div className="chart-container emp3d-chart-container">
                {mySerials.length ? (
                  <ChartBox
                    allowedSerials={mySerials}
                    defaultSerial={defaultSerial}
                  />
                ) : (
                  <div className="empty-state emp3d-empty-state">
                    <img
                      src="/Pictures/empty-graph.svg"
                      alt=""
                      aria-hidden="true"
                    />
                    <p>Chưa có thiết bị nào được gán cho tài khoản của bạn.</p>
                  </div>
                )}
              </div>
            </section>
          )}

          {activeSection === "thresholds" && (
            <section
              className="chart-section emp3d-glass-card emp3d-threshold-card"
              aria-label="Ngưỡng cảnh báo của tôi"
            >
              <div className="section-head emp3d-card-head">
                <div>
                  <span className="emp3d-eyebrow">ALERT RULES</span>
                  <h2>🌡️ Ngưỡng cảnh báo của tôi</h2>
                  <small className="muted">
                    Chỉ thao tác với thiết bị thuộc quyền của bạn.
                  </small>
                </div>
              </div>

              <div className="admin-form admin-form--narrow th-grid emp3d-th-grid">
                <label className="emp3d-field">
                  <span>Thiết bị</span>
                  <select
                    className="admin-select"
                    value={thSerial}
                    onChange={(e) => setThSerial(e.target.value)}
                  >
                    <option value="">-- Chọn thiết bị của tôi --</option>
                    {mySerials.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="emp3d-field">
                  <span>Upper Threshold (°C)</span>
                  <input
                    placeholder="Ví dụ: 8.0"
                    value={thUpper}
                    onChange={(e) => setThUpper(e.target.value)}
                    type="number"
                    step="0.1"
                  />
                </label>

                <label className="emp3d-field">
                  <span>Lower Threshold (°C)</span>
                  <input
                    placeholder="Ví dụ: 2.0"
                    value={thLower}
                    onChange={(e) => setThLower(e.target.value)}
                    type="number"
                    step="0.1"
                  />
                </label>

                <div className="row-flex emp3d-action-row">
                  <button
                    className="emp3d-soft-btn"
                    onClick={loadMyThreshold}
                    disabled={thLoading}
                  >
                    {thLoading ? "Đang tải..." : "Tải ngưỡng hiện tại"}
                  </button>
                  <button
                    className="emp3d-primary-btn"
                    onClick={saveMyThreshold}
                    disabled={thLoading}
                  >
                    {thLoading ? "Đang lưu..." : "Lưu ngưỡng"}
                  </button>
                </div>
              </div>

              {thMsg && (
                <div className="mt-6 th-msg emp3d-message">{thMsg}</div>
              )}
              <p className="hint emp3d-hint">
                Lưu ý: Upper/Lower để trống nghĩa là không dùng ngưỡng đó.
              </p>
            </section>
          )}

          {activeSection === "tasks" && (
            <section
              className="task-section emp3d-glass-card emp3d-task-card"
              aria-label="Danh sách công việc"
            >
              <div className="emp3d-card-head">
                <div>
                  <span className="emp3d-eyebrow">DAILY WORK</span>
                  <h2 className="motivation">🧩 Smart Tech Workboard</h2>
                  <small className="muted">
                    Mỗi công việc là một cơ hội để bứt phá, truyền cảm hứng và
                    tạo nên kết quả tốt hơn.
                  </small>
                </div>
              </div>
              <TaskList
                notifications={notifications}
                accountId={compareId}
                handleUpdateStatus={handleUpdateStatus}
              />
            </section>
          )}

          {activeSection === "notifications" && (
            <section
              className="task-section emp3d-glass-card emp3d-notification-center"
              aria-label="Thông báo"
            >
              <div className="emp3d-card-head">
                <div>
                  <span className="emp3d-eyebrow">NOTIFICATIONS</span>
                  <h2>🔔 Thông báo</h2>
                </div>
                <button
                  className="emp3d-soft-btn"
                  type="button"
                  onClick={handleMarkAllAsRead}
                >
                  Đánh dấu đã đọc
                </button>
              </div>
              <NotificationPopup
                notifications={notifications}
                isOpen={true}
                onMarkAsRead={handleMarkAsRead}
                onMarkAllAsRead={handleMarkAllAsRead}
              />
            </section>
          )}
        </main>
      </div>

      <div
        className="toast-stack emp3d-toast-stack"
        role="region"
        aria-live="polite"
      >
        {toasts.map((t, i) => {
          const typ = parseAlertType(t.message);
          const cls =
            typ === "power_loss"
              ? "toast--danger"
              : typ === "power_restore"
                ? "toast--ok"
                : getSeverity(t) === "critical"
                  ? "toast--critical"
                  : "toast--warning";
          return (
            <div
              key={`${t.serialNumber}-${t.timeUtc}-${i}`}
              className={`toast emp3d-toast ${cls}`}
            >
              <div className="toast__title">
                {t.message}{" "}
                <span className="toast__serial">• {t.serialNumber}</span>
              </div>
              <div className="toast__body">{t.notes || "—"}</div>
            </div>
          );
        })}
      </div>

      {warrantyList && (
        <WarrantyPopup
          data={warrantyList}
          onClose={() => setWarrantyList(null)}
          onMarkedSeen={handleMarkedSeen}
        />
      )}
    </div>
  );
};

export default Employee;
