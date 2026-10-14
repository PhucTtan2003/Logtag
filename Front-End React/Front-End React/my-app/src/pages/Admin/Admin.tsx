// src/pages/Admin/Admin.tsx
import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
} from "react";
import "../../styles/Admin/Admin.css";
import AdminSidebar from "../../components/SideBar/AdminSideBar";
import RegisterDevicePanel from "../../components/RegisterDevicePanel";
import type { SectionType } from "../../types/types";
import { useAuth } from "../../contexts/AuthContext";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Cpu,
  Edit2,
  Gauge,
  Loader2,
  Lock,
  PlusCircle,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Thermometer,
  Trash2,
  Unlock,
  UserRound,
} from "lucide-react";
import ModalPortal from "../../components/ModalPortal";
import AdminSmsScheduleMonitor from "./AdminSmsScheduleMonitor";

// Hooks & panels
import { useAdminAccount } from "../../hooks/useAdminAccount";
import RebalancePanel from "./sections/RebalancePanel";
import ChartsPanel from "../../components/Chart/ChartPanel";
import NotifyPanel from "./sections/NotifyPanel";
import TaskStatusPanel from "./sections/TaskStatusPanel";
import AdminEventsPanel from "../../components/AdminEventsPanel";
import AdminAccountDevices from "../Admin/AdminAccountDevices";
import ProductList from "../../components/ProductList";
import ProfilesPage from "../Profile/ProfilePage";
import { useNavigate } from "react-router-dom";

// axios & SignalR
import api, { absUrl } from "../../api/axios";
import { ensureStarted, getLogTagConnection } from "../../realtime/logtaghub";

/* ======================= Types cho alert widget ======================= */
type LiveAlertDto = {
  SerialNumber: string;
  Notes?: string | null;
  Message: string;
  TimeUtc: string | Date;
};

/* ======================= helpers ======================= */
const parseType = (msg: string) => {
  const m = (msg || "").toLowerCase();
  if (m.includes("temperature") && m.includes("alarm") && m.includes("high"))
    return "temperature_high";
  if (m.includes("temperature") && m.includes("alarm") && m.includes("low"))
    return "temperature_low";
  if (m.includes("power") && m.includes("restore")) return "power_restore";
  if (m.includes("power") && (m.includes("loss") || m.includes("lost")))
    return "power_loss";
  if (m.includes("battery") && m.includes("low")) return "battery_low";
  return "other";
};

/* ======================= Component chính ======================= */
const Admin: React.FC = () => {
  const [activeSection, setActiveSection] = useState<SectionType>("account");
  const [showRegModal, setShowRegModal] = useState(false);
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleAdminLogout = useCallback(() => {
    void logout();

    localStorage.removeItem("token");
    localStorage.removeItem("userId");
    localStorage.removeItem("uid");
    localStorage.removeItem("role");
    localStorage.removeItem("accountId");
    localStorage.removeItem("name");
    localStorage.removeItem("email");
    localStorage.removeItem("fullName");

    navigate("/", { replace: true });
  }, [logout, navigate]);

  // ===== Account management =====
  const {
    users,
    roles,
    form,
    editingId,
    searchTerm,
    confirmBox,
    loading,
    setForm,
    setEditingId,
    setSearchTerm,
    setConfirmBox,
    handleInputChange,
    handleAddOrUpdate,
    handleEdit,
    handleToggleActive,
    handleDelete,
    confirmToggleActive,
  } = useAdminAccount();

  const onRegistered = useCallback(async () => {
    setShowRegModal(false);
  }, []);

  // Cleanup scroll locks when entering page
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    html.classList.remove("no-scroll");
    body.classList.remove("no-scroll");
    html.style.overflow = "";
    body.style.overflow = "";
  }, []);

  // ESC để đóng modal đăng ký thiết bị
  useEffect(() => {
    if (!showRegModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowRegModal(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showRegModal]);

  // Modal scroll lock
  const isAnyModalOpen = showRegModal || confirmBox.open;
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    if (isAnyModalOpen) {
      html.classList.add("no-scroll");
      body.classList.add("no-scroll");
    } else {
      html.classList.remove("no-scroll");
      body.classList.remove("no-scroll");
      html.style.overflow = "";
      body.style.overflow = "";
    }
    return () => {
      html.classList.remove("no-scroll");
      body.classList.remove("no-scroll");
      html.style.overflow = "";
      body.style.overflow = "";
    };
  }, [isAnyModalOpen]);

  /* ======================= Thresholds ======================= */
  const [thSerial, setThSerial] = useState<string>("");
  const [thUpper, setThUpper] = useState<string>("");
  const [thLower, setThLower] = useState<string>("");
  const [thLoading, setThLoading] = useState(false);
  const [thMsg, setThMsg] = useState<string>("");

  const loadThreshold = useCallback(async () => {
    setThMsg("");

    const serial = thSerial.trim();

    if (!serial) {
      setThMsg("Chọn SerialNumber trước.");
      return;
    }

    setThLoading(true);

    try {
      const { data: res } = await api.get(
        `/api/alert-thresholds/v1/${encodeURIComponent(serial)}`
      );

      const upper =
        res?.data?.upperThreshold ?? res?.upperThreshold ?? res?.max ?? null;

      const lower =
        res?.data?.lowerThreshold ?? res?.lowerThreshold ?? res?.min ?? null;

      setThUpper(upper == null ? "" : String(upper));
      setThLower(lower == null ? "" : String(lower));

      setThMsg("Đã tải cấu hình hiện tại.");
    } catch (err: any) {
      if (err?.response?.status === 404) {
        setThUpper("");
        setThLower("");
        setThMsg("Chưa có cấu hình cho serial này.");
      } else {
        setThMsg(
          `Không tải được cấu hình.${err?.message ? " " + String(err.message) : ""}`
        );
      }
    } finally {
      setThLoading(false);
    }
  }, [thSerial]);

  const saveThreshold = useCallback(async () => {
    const serial = thSerial.trim();

    if (!serial) {
      setThMsg("Nhập SerialNumber trước.");
      return;
    }

    const up =
      thUpper === "" ? null : Number.isFinite(Number(thUpper)) ? Number(thUpper) : NaN;

    const lo =
      thLower === "" ? null : Number.isFinite(Number(thLower)) ? Number(thLower) : NaN;

    if (Number.isNaN(up) || Number.isNaN(lo)) {
      setThMsg("Giá trị ngưỡng không hợp lệ.");
      return;
    }

    setThLoading(true);
    setThMsg("");

    try {
      await api.put(`/api/alert-thresholds/v1`, {
        serialNumber: serial,
        upperThreshold: up,
        lowerThreshold: lo,
      });

      setThMsg("Đã lưu ngưỡng.");
    } catch (err: any) {
      setThMsg(
        `Lưu thất bại.${err?.response?.status ? ` (HTTP ${err.response.status})` : ""}${
          err?.message ? " " + String(err.message) : ""
        }`
      );
    } finally {
      setThLoading(false);
    }
  }, [thSerial, thUpper, thLower]);

  /* ======================= Devices (Admin) ======================= */
  const [deviceList, setDeviceList] = useState<string[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/api/devices/all");
        setDeviceList(res.data?.data ?? []);
      } catch (err) {
        console.error("Không tải được danh sách thiết bị:", err);
        setDeviceList([]);
      }
    })();
  }, []);

  const [deviceQuery, setDeviceQuery] = useState<string>("");
  const filteredDevices = useMemo(() => {
    const key = (deviceQuery || "").trim().toUpperCase();
    if (!key) return deviceList;
    return deviceList.filter((sn) => (sn || "").toUpperCase().includes(key));
  }, [deviceList, deviceQuery]);

  const [chartSerial, setChartSerial] = useState<string>("");
  useEffect(() => {
    if (!chartSerial && deviceList.length > 0) {
      setChartSerial(deviceList[0]);
    }
  }, [deviceList, chartSerial]);

  /* ======================= Filter users ======================= */
  const filteredUsers = useMemo(() => {
    const q = (searchTerm || "").toLowerCase().trim();
    if (!q) return users;
    return users.filter((u) =>
      [u.fullName, u.email, u.phone, u.roleName]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [users, searchTerm]);

  const accountStats = useMemo(() => {
    const total = users.length;
    const active = users.filter((u) => u.isActive).length;
    const inactive = total - active;
    const admins = users.filter((u) =>
      String(u.roleName || "").toLowerCase().includes("admin")
    ).length;
    return { total, active, inactive, admins };
  }, [users]);

  /* =================== ADMIN ALERT WIDGET =================== */
  const [alerts, setAlerts] = useState<LiveAlertDto[]>([]);
  const loadRecentAlerts = useCallback(async (minutes = 60, limit = 50) => {
    try {
      const { data: res } = await api.get(`/api/admin/alerts/recent`, {
        params: { minutes, limit },
      });
      const arr: any[] = res?.data ?? [];
      const mapped: LiveAlertDto[] = arr.map((x) => ({
        SerialNumber: String(x?.SerialNumber || x?.serialNumber || "").toUpperCase(),
        Notes: null,
        Message: String(x?.Message || x?.message || "Event"),
        TimeUtc: x?.TimeUtc || x?.timeUtc || new Date().toISOString(),
      }));
      setAlerts(mapped);
    } catch (e) {
      console.error("Load recent alerts failed", e);
      setAlerts([]);
    }
  }, []);

  useEffect(() => {
    loadRecentAlerts(60, 50);
  }, [loadRecentAlerts]);

  const alertStats = useMemo(() => {
    const critical = alerts.filter((a) => {
      const t = parseType(a.Message);
      return t === "temperature_high" || t === "temperature_low" || t === "power_loss";
    }).length;
    return { total: alerts.length, critical };
  }, [alerts]);

  /* ============= SignalR: auto-refresh threshold panel ============= */
  useEffect(() => {
    let connRef: any | null = null;
    const handler = (payload: any) => {
      const typ = String(payload?.type || "").toLowerCase();
      if (!typ.includes("threshold")) return;
      const serialChanged = (payload?.serialNumber || "")
        .toString()
        .trim()
        .toUpperCase();
      const current = thSerial.trim().toUpperCase();
      if (activeSection === "thresholds" && serialChanged && serialChanged === current) {
        loadThreshold();
        setThMsg("Có thay đổi ngưỡng từ server. Đã cập nhật.");
      }
    };

    (async () => {
      try {
        const tokenFactory = () =>
          localStorage.getItem("userId") || localStorage.getItem("uid") || "";
        const conn = getLogTagConnection(absUrl("/hub/logtag"), tokenFactory);
        await ensureStarted(conn);
        connRef = conn;
        conn.invoke("RefreshGroups").catch(() => {});
        conn.on("ReceiveAdminEvent", handler);
      } catch {
        // ignore connection error
      }
    })();

    return () => {
      if (connRef) connRef.off("ReceiveAdminEvent", handler);
    };
  }, [activeSection, thSerial, loadThreshold]);

  const hasThreshold = thUpper !== "" || thLower !== "";

  const sectionView = useMemo(() => {
    const map: Record<string, { kicker: string; title: string; desc: string }> = {
      account: {
        kicker: "People desk",
        title: "Quản lý tài khoản",
        desc: "Tạo, phân quyền, khoá/mở và theo dõi người dùng trong một màn hình gọn.",
      },
      product: {
        kicker: "Warranty",
        title: "Danh sách bảo hành",
        desc: "Theo dõi thiết bị và yêu cầu bảo hành của khách hàng.",
      },
      chart: {
        kicker: "Sensor data",
        title: "Biểu đồ thiết bị",
        desc: "Xem dữ liệu nhiệt độ, độ ẩm theo serial và khoảng thời gian.",
      },
      devicelist: {
        kicker: "Devices",
        title: "Danh sách thiết bị",
        desc: "Tìm serial nhanh và chuyển thẳng sang biểu đồ khi cần kiểm tra dữ liệu.",
      },
      notify: {
        kicker: "Dispatch",
        title: "Điều phối thông báo",
        desc: "Gửi thông báo hoặc giao việc cho nhân viên vận hành.",
      },
      smsSchedule: {
        kicker: "Automation",
        title: "Quyền SMS định kỳ",
        desc: "Kiểm soát quyền gửi SMS định kỳ theo người dùng và lịch vận hành.",
      },
      taskstatus: {
        kicker: "Tasks",
        title: "Trạng thái nhiệm vụ",
        desc: "Theo dõi tiến độ xử lý công việc đã giao cho nhân viên.",
      },
      rebalance: {
        kicker: "Balancer",
        title: "Chia đều thiết bị",
        desc: "Phân bổ thiết bị cho nhân viên theo team một cách cân bằng hơn.",
      },
      assigdevicestouser: {
        kicker: "Assignment",
        title: "Gán thiết bị cho User",
        desc: "Chủ động gán serial cho từng người dùng trong hệ thống.",
      },
      events: {
        kicker: "Events",
        title: "Trung tâm sự kiện",
        desc: "Tra cứu cảnh báo, pin, kết nối và các sự kiện phát sinh gần đây.",
      },
      profiles: {
        kicker: "Profiles",
        title: "Profiles",
        desc: "Quản lý profile cấu hình từ LogTag/thiết bị.",
      },
      thresholds: {
        kicker: "Guardrails",
        title: "Ngưỡng cảnh báo",
        desc: "Thiết lập vùng an toàn nhiệt độ cho từng serial thiết bị.",
      },
    };

    return map[String(activeSection)] ?? map.account;
  }, [activeSection]);

  /* ======================= RENDER ======================= */
  return (
    <div className="admin-scope admin-forward">
      <div className="admin-shell">
        <AdminSidebar
          activeSection={activeSection}
          setActiveSection={setActiveSection}
          onLogout={handleAdminLogout}
          setShowRegModal={setShowRegModal}
        />

        <main className="admin-main admin-main--forward">
          <div className="admin-orbit-bg" aria-hidden="true" />

          {/* Hero removed: mở thẳng vào nội dung Admin */}

          <header className="admin-workspace-head">
            <div className="workspace-copy">
              <span>{sectionView.kicker}</span>
              <h1>{sectionView.title}</h1>
              <p>{sectionView.desc}</p>
            </div>

            <div className="workspace-tools" aria-label="Thao tác nhanh">
              <div className="workspace-metric">
                <strong>{accountStats.total}</strong>
                <small>tài khoản</small>
              </div>
              <div className="workspace-metric">
                <strong>{deviceList.length}</strong>
                <small>thiết bị</small>
              </div>
              <button
                type="button"
                className="workspace-btn workspace-btn--primary"
                onClick={() => setShowRegModal(true)}
              >
                <PlusCircle size={16} />
                Đăng ký thiết bị
              </button>
              <button
                type="button"
                className="workspace-btn"
                onClick={() => setActiveSection("events")}
              >
                <Activity size={16} />
                Sự kiện
              </button>
            </div>
          </header>

          <div className="admin-content-shell">
            {/* ACCOUNT */}
            <section id="panel-account" hidden={activeSection !== "account"}>
              {activeSection === "account" && (
                <div className="admin-panel admin-panel--account">
                  <div className="panel-title-row">
                    <div>
                      <span className="panel-tag">People Operating System</span>
                      <h2>Quản lý tài khoản thông minh</h2>
                    </div>
                    <div className="panel-mini-stats">
                      <span><CheckCircle2 size={15} /> {accountStats.active} active</span>
                      <span><Lock size={15} /> {accountStats.inactive} khóa</span>
                      <span><ShieldCheck size={15} /> {accountStats.admins} admin</span>
                    </div>
                  </div>

                  <div className="account-studio">
                    <div className="forward-card account-editor">
                      <div className="card-headline">
                        <span className="soft-icon"><UserRound size={18} /></span>
                        <div>
                          <h3>{editingId ? "Cập nhật tài khoản" : "Tạo tài khoản mới"}</h3>
                          <p>Điền thông tin một lần, hệ thống sẽ đưa vào danh sách vận hành ngay.</p>
                        </div>
                      </div>

                      <div className="form-grid-modern">
                        <label className="field-modern">
                          <span>Họ tên</span>
                          <input
                            name="fullName"
                            placeholder="VD: Nguyễn Văn A"
                            value={form.fullName || ""}
                            onChange={handleInputChange}
                          />
                        </label>

                        <label className="field-modern">
                          <span>Email</span>
                          <input
                            name="email"
                            placeholder="name@company.com"
                            value={form.email || ""}
                            onChange={handleInputChange}
                          />
                        </label>

                        <label className="field-modern">
                          <span>Số điện thoại</span>
                          <input
                            name="phone"
                            placeholder="09xx xxx xxx"
                            value={form.phone || ""}
                            onChange={handleInputChange}
                          />
                        </label>

                        <label className="field-modern">
                          <span>Địa chỉ</span>
                          <input
                            name="address"
                            placeholder="Kho / chi nhánh / khu vực"
                            value={form.address || ""}
                            onChange={handleInputChange}
                          />
                        </label>

                        <label className="field-modern">
                          <span>Mật khẩu</span>
                          <input
                            name="passwords"
                            type="password"
                            autoComplete="new-password"
                            placeholder={editingId ? "Để trống nếu không đổi" : "Tạo mật khẩu"}
                            value={form.passwords || ""}
                            onChange={handleInputChange}
                          />
                        </label>

                        <label className="field-modern">
                          <span>Vai trò</span>
                          <select
                            name="roleId"
                            title="Chọn vai trò"
                            value={form.roleId || ""}
                            onChange={handleInputChange}
                          >
                            <option value="">-- Chọn vai trò --</option>
                            {roles.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.roleName}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <div className="form-actions-modern">
                        <button
                          type="button"
                          className="neo-btn neo-btn--primary"
                          onClick={handleAddOrUpdate}
                          disabled={loading}
                        >
                          {loading ? (
                            <Loader2 className="spin" size={18} />
                          ) : editingId ? (
                            <Edit2 size={16} />
                          ) : (
                            <UserRound size={16} />
                          )}
                          {editingId ? "Cập nhật tài khoản" : "Thêm tài khoản"}
                        </button>

                        {editingId && (
                          <button
                            type="button"
                            className="neo-btn"
                            onClick={() => {
                              setForm({});
                              setEditingId(null);
                            }}
                          >
                            Hủy chỉnh sửa
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="forward-card account-directory">
                      <div className="directory-topbar">
                        <div>
                          <h3>Danh bạ vận hành</h3>
                          <p>{filteredUsers.length}/{users.length} tài khoản khớp bộ lọc</p>
                        </div>

                        <label className="search-modern">
                          <Search size={17} />
                          <input
                            type="text"
                            placeholder="Tìm tên, email, SĐT, vai trò..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                          />
                        </label>
                      </div>

                      <div className="table-container table-container--neo">
                        <table className="admin-table admin-table--neo">
                          <thead>
                            <tr>
                              <th>Người dùng</th>
                              <th>Liên hệ</th>
                              <th>Khu vực</th>
                              <th>Vai trò</th>
                              <th>Trạng thái</th>
                              <th>Hành động</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredUsers.map((u) => (
                              <tr key={u.id}>
                                <td data-label="Người dùng">
                                  <div className="user-cell">
                                    <span className="avatar-dot">
                                      {(u.fullName || u.email || "U").slice(0, 1).toUpperCase()}
                                    </span>
                                    <div>
                                      <strong>{u.fullName || "—"}</strong>
                                      <small>••••••••</small>
                                    </div>
                                  </div>
                                </td>
                                <td data-label="Liên hệ">
                                  <div className="stack-cell">
                                    <span>{u.email || "—"}</span>
                                    <small>{u.phone || "Chưa có SĐT"}</small>
                                  </div>
                                </td>
                                <td data-label="Khu vực">{u.address || "—"}</td>
                                <td data-label="Vai trò">
                                  <span className="role-pill">{u.roleName || "N/A"}</span>
                                </td>
                                <td data-label="Trạng thái">
                                  <span className={u.isActive ? "state-pill state-pill--on" : "state-pill state-pill--off"}>
                                    {u.isActive ? "Hoạt động" : "Bị khóa"}
                                  </span>
                                </td>
                                <td data-label="Hành động">
                                  <div className="table-actions-modern">
                                    <button
                                      className="table-action-btn edit"
                                      onClick={() => handleEdit(u)}
                                      title="Sửa"
                                      type="button"
                                    >
                                      <Edit2 size={15} />
                                    </button>
                                    {u.roleName?.toLowerCase() !== "admin" && (
                                      <button
                                        className="table-action-btn delete"
                                        onClick={() => handleDelete(u.id)}
                                        title="Xóa"
                                        type="button"
                                      >
                                        <Trash2 size={15} />
                                      </button>
                                    )}
                                    <button
                                      className="table-action-btn lock"
                                      onClick={() => handleToggleActive(u.id)}
                                      title={u.isActive ? "Khóa" : "Mở khóa"}
                                      type="button"
                                    >
                                      {u.isActive ? <Lock size={15} /> : <Unlock size={15} />}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>

                        {loading && (
                          <div className="wow-table-loading wow-table-loading--neo">
                            <Loader2 className="spin" size={28} />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {confirmBox.open && (
                    <ModalPortal>
                      <div className="confirm-overlay confirm-overlay--neo">
                        <div className="confirm-box confirm-box--neo">
                          <span className="confirm-icon"><ShieldCheck size={22} /></span>
                          <h3>
                            Bạn có muốn {users.find((u) => u.id === confirmBox.userId)?.isActive ? "khóa" : "mở khóa"} tài khoản này không?
                          </h3>
                          <p>Thao tác này sẽ ảnh hưởng quyền truy cập vào hệ thống.</p>
                          <div className="confirm-actions">
                            <button onClick={confirmToggleActive} disabled={loading} type="button">
                              Xác nhận
                            </button>
                            <button
                              onClick={() => setConfirmBox({ open: false, userId: null })}
                              disabled={loading}
                              type="button"
                            >
                              Hủy
                            </button>
                          </div>
                        </div>
                      </div>
                    </ModalPortal>
                  )}
                </div>
              )}
            </section>

            {/* THRESHOLDS */}
            <section id="panel-thresholds" hidden={activeSection !== "thresholds"}>
              {activeSection === "thresholds" && (
                <div className="admin-panel admin-panel--thresholds">
                  <div className="panel-title-row">
                    <div>
                      <span className="panel-tag">Predictive Guardrail</span>
                      <h2>Ngưỡng cảnh báo chủ động</h2>
                    </div>
                    <button
                      type="button"
                      className="neo-btn"
                      onClick={() => setActiveSection("devicelist")}
                    >
                      Mở danh sách thiết bị <ArrowRight size={15} />
                    </button>
                  </div>

                  <div className="threshold-console">
                    <div className="forward-card threshold-radar">
                      <div className="radar-core">
                        <span className="radar-ring radar-ring--one" />
                        <span className="radar-ring radar-ring--two" />
                        <span className="radar-ring radar-ring--three" />
                        <Thermometer size={42} />
                      </div>
                      <h3>{thSerial || "Chọn một Serial"}</h3>
                      <p>
                        {hasThreshold
                          ? `Vùng an toàn: ${thLower || "−∞"}°C đến ${thUpper || "+∞"}°C`
                          : "Chưa tải hoặc chưa cấu hình ngưỡng cho thiết bị này."}
                      </p>
                      <div className="threshold-status-row">
                        <span className={hasThreshold ? "state-pill state-pill--on" : "state-pill"}>
                          {hasThreshold ? "Đang cấu hình" : "Chờ thiết lập"}
                        </span>
                        <span>{deviceList.length} serial khả dụng</span>
                      </div>
                    </div>

                    <div className="forward-card threshold-editor">
                      <div className="card-headline">
                        <span className="soft-icon"><SlidersHorizontal size={18} /></span>
                        <div>
                          <h3>Thiết lập vùng an toàn</h3>
                          <p>Nhập giới hạn dưới và trên. Để trống nếu không muốn áp dụng chiều đó.</p>
                        </div>
                      </div>

                      <div className="form-grid-modern form-grid-modern--threshold">
                        <label className="field-modern field-modern--wide">
                          <span>SerialNumber</span>
                          <select
                            className="admin-select"
                            value={thSerial}
                            onChange={(e) => {
                              setThSerial(e.target.value);
                              setThMsg("");
                            }}
                          >
                            <option value="">-- Chọn thiết bị --</option>
                            {deviceList.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="field-modern">
                          <span>Ngưỡng dưới (°C)</span>
                          <input
                            placeholder="VD: 2"
                            value={thLower}
                            onChange={(e) => setThLower(e.target.value)}
                            type="number"
                            step="0.1"
                          />
                        </label>

                        <label className="field-modern">
                          <span>Ngưỡng trên (°C)</span>
                          <input
                            placeholder="VD: 8"
                            value={thUpper}
                            onChange={(e) => setThUpper(e.target.value)}
                            type="number"
                            step="0.1"
                          />
                        </label>
                      </div>

                      <div className="form-actions-modern">
                        <button
                          type="button"
                          className="neo-btn"
                          onClick={loadThreshold}
                          disabled={thLoading}
                        >
                          {thLoading ? <Loader2 className="spin" size={16} /> : <Gauge size={16} />}
                          Tải ngưỡng hiện tại
                        </button>
                        <button
                          type="button"
                          className="neo-btn neo-btn--primary"
                          onClick={saveThreshold}
                          disabled={thLoading}
                        >
                          {thLoading ? <Loader2 className="spin" size={16} /> : <CheckCircle2 size={16} />}
                          Lưu ngưỡng
                        </button>
                      </div>

                      {thMsg && <div className="inline-system-message">{thMsg}</div>}
                      <p className="hint hint--neo">
                        Danh sách serial Admin lấy từ <code>/api/devices/all</code>.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* DEVICE LIST */}
            <section id="panel-devicelist" hidden={activeSection !== "devicelist"}>
              {activeSection === "devicelist" && (
                <div className="admin-panel admin-panel--devices">
                  <div className="panel-title-row">
                    <div>
                      <span className="panel-tag">Device Launchpad</span>
                      <h2>Chọn thiết bị để đi tiếp</h2>
                    </div>
                    <div className="device-count-pill">
                      {filteredDevices.length}/{deviceList.length} thiết bị
                    </div>
                  </div>

                  <div className="device-toolbar device-toolbar--neo">
                    <label className="search-modern search-modern--wide">
                      <Search size={18} />
                      <input
                        className="device-search-input"
                        type="text"
                        placeholder="Gõ serial để lọc tức thì..."
                        value={deviceQuery}
                        onChange={(e) => setDeviceQuery(e.target.value)}
                      />
                    </label>
                  </div>

                  <div className="device-grid device-grid--neo">
                    {filteredDevices.length === 0 && (
                      <div className="device-grid__empty">Không có thiết bị phù hợp.</div>
                    )}

                    {filteredDevices.map((sn, idx) => (
                      <button
                        key={sn}
                        type="button"
                        className="device-card device-card--neo"
                        onClick={() => {
                          setChartSerial(sn);
                          setActiveSection("chart");
                        }}
                        title={`Xem biểu đồ của ${sn}`}
                      >
                        <div className="device-card__head">
                          <span className="device-chip">#{String(idx + 1).padStart(2, "0")}</span>
                          <Cpu size={18} />
                        </div>
                        <div className="device-card__serial">{sn}</div>
                        <div className="device-card__sub">
                          Mở biểu đồ <ArrowRight size={14} />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* CHART */}
            <section id="panel-chart" hidden={activeSection !== "chart"}>
              {activeSection === "chart" && (
                <div className="module-frame module-frame--chart">
                  <ChartsPanel defaultSerial={chartSerial} allowedSerials={deviceList} />
                </div>
              )}
            </section>

            {/* NOTIFY */}
            <section id="panel-notify" hidden={activeSection !== "notify"}>
              {activeSection === "notify" && (
                <div className="module-frame">
                  <NotifyPanel onClose={() => setActiveSection("account")} />
                </div>
              )}
            </section>

            {/* SMS SCHEDULE PERMISSION */}
            <section id="panel-smsSchedule" hidden={activeSection !== "smsSchedule"}>
              {activeSection === "smsSchedule" && (
                <div className="module-frame">
                  <AdminSmsScheduleMonitor />
                </div>
              )}
            </section>

            {/* TASK STATUS */}
            <section id="panel-taskstatus" hidden={activeSection !== "taskstatus"}>
              {activeSection === "taskstatus" && (
                <div className="module-frame">
                  <TaskStatusPanel />
                </div>
              )}
            </section>

            {/* REBALANCE */}
            <section id="panel-rebalance" hidden={activeSection !== "rebalance"}>
              {activeSection === "rebalance" && (
                <div className="module-frame">
                  <RebalancePanel />
                </div>
              )}
            </section>

            {/* ASSIGN DEVICES TO USER */}
            <section id="panel-assigdevicestouser" hidden={activeSection !== "assigdevicestouser"}>
              {activeSection === "assigdevicestouser" && (
                <div className="module-frame">
                  <AdminAccountDevices />
                </div>
              )}
            </section>

            {/* PRODUCT */}
            <section id="panel-product" hidden={activeSection !== "product"}>
              {activeSection === "product" && (
                <div className="module-frame">
                  <ProductList />
                </div>
              )}
            </section>

            {/* EVENTS */}
            <section id="panel-events" hidden={activeSection !== "events"}>
              {activeSection === "events" && (
                <div className="module-frame module-frame--events">
                  <AdminEventsPanel />
                </div>
              )}
            </section>

            {/* PROFILES */}
            <section id="panel-profiles" hidden={activeSection !== "profiles"}>
              {activeSection === "profiles" && (
                <div className="module-frame">
                  <ProfilesPage />
                </div>
              )}
            </section>
          </div>

          {/* Modal Đăng ký thiết bị */}
          {showRegModal && (
            <ModalPortal>
              <div
                className="confirm-overlay confirm-overlay--neo"
                role="dialog"
                aria-modal="true"
                aria-labelledby="register-device-title"
                onClick={() => setShowRegModal(false)}
              >
                <div className="confirm-box confirm-box--register" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="close-modal-btn close-modal-btn--neo"
                    onClick={() => setShowRegModal(false)}
                    aria-label="Đóng"
                    type="button"
                  >
                    ×
                  </button>
                  <RegisterDevicePanel onSuccess={onRegistered} onClose={() => setShowRegModal(false)} />
                </div>
              </div>
            </ModalPortal>
          )}
        </main>
      </div>
    </div>
  );
};

export default Admin;