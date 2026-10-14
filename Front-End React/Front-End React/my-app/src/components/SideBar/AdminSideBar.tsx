// src/components/SideBar/AdminSideBar.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  BarChart3,
  BellRing,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  Crown,
  Database,
  HardDrive,
  IdCard,
  LineChart,
  LogOut,
  Menu,
  PackageSearch,
  PhoneCall,
  PlusCircle,
  Search,
  Settings2,
  ShieldCheck,
  Shuffle,
  Sparkles,
  ThermometerSun,
  TicketPercent,
  UserCog,
  Webhook,
  X,
} from "lucide-react";
import type { SectionType } from "../../types/types";
import "../../styles/SideBar/SideBar.css";

interface AdminSidebarProps {
  activeSection: SectionType;
  setActiveSection: React.Dispatch<React.SetStateAction<SectionType>>;
  onLogout: () => void;
  setShowRegModal?: React.Dispatch<React.SetStateAction<boolean>>;
}

type LocalMenuItem = {
  type: "local";
  key: SectionType;
  label: string;
  desc: string;
  icon: React.ElementType;
};

type RouteMenuItem = {
  type: "route";
  to: string;
  label: string;
  desc: string;
  icon: React.ElementType;
  end?: boolean;
};

type MenuItem = LocalMenuItem | RouteMenuItem;

type MenuGroup = {
  title: string;
  eyebrow: string;
  items: MenuItem[];
};

const groups: MenuGroup[] = [
  {
    title: "Điều hành",
    eyebrow: "Core",
    items: [
      {
        type: "local",
        key: "account" as SectionType,
        label: "Thông tin tài khoản",
        desc: "Quản lý người dùng và quyền truy cập",
        icon: UserCog,
      },
      {
        type: "local",
        key: "product" as SectionType,
        label: "Danh sách bảo hành",
        desc: "Theo dõi yêu cầu và thiết bị bảo hành",
        icon: PackageSearch,
      },
      {
        type: "local",
        key: "chart" as SectionType,
        label: "Xem biểu đồ",
        desc: "Dữ liệu nhiệt độ, độ ẩm theo thời gian",
        icon: LineChart,
      },
      {
        type: "local",
        key: "devicelist" as SectionType,
        label: "Danh sách thiết bị",
        desc: "Kiểm tra thiết bị đã gán và trạng thái",
        icon: HardDrive,
      },
      {
        type: "local",
        key: "notify" as SectionType,
        label: "Điều phối",
        desc: "Gửi thông báo và giao nhiệm vụ",
        icon: BellRing,
      },
      {
        type: "local",
        key: "taskstatus" as SectionType,
        label: "Trạng thái nhiệm vụ",
        desc: "Theo dõi hoàn thành và xử lý",
        icon: ClipboardCheck,
      },
    ],
  },
  {
    title: "Tự động hóa",
    eyebrow: "Control",
    items: [
      {
        type: "local",
        key: "smsSchedule" as SectionType,
        label: "Quyền SMS định kỳ",
        desc: "Bật/tắt quyền gửi SMS theo lịch",
        icon: PhoneCall,
      },
      {
        type: "local",
        key: "rebalance" as SectionType,
        label: "Chia đều thiết bị",
        desc: "Cân bằng thiết bị cho nhân viên",
        icon: Shuffle,
      },
      {
        type: "local",
        key: "assigdevicestouser" as SectionType,
        label: "Gán thiết bị cho User",
        desc: "Liên kết thiết bị với tài khoản người dùng",
        icon: Settings2,
      },
      {
        type: "local",
        key: "events" as SectionType,
        label: "Sự kiện",
        desc: "Timeline cảnh báo và trạng thái LogTag",
        icon: CalendarDays,
      },
      {
        type: "local",
        key: "profiles" as SectionType,
        label: "Profiles",
        desc: "Hồ sơ cấu hình thiết bị từ LogTag",
        icon: IdCard,
      },
      {
        type: "local",
        key: "thresholds" as SectionType,
        label: "Ngưỡng cảnh báo",
        desc: "Thiết lập biên an toàn nhiệt độ/độ ẩm",
        icon: ThermometerSun,
      },
    ],
  },
  {
    title: "License & thuê bao",
    eyebrow: "Growth",
    items: [
      {
        type: "route",
        to: "/admin/license-codes",
        label: "Mã kích hoạt",
        desc: "Tạo và cấp mã dịch vụ cho khách hàng",
        icon: TicketPercent,
      },
      {
        type: "route",
        to: "/admin/subscriptions",
        label: "Gói & thuê bao",
        desc: "Quản lý hạn dùng, feature và trạng thái gói",
        icon: Crown,
      },
      {
        type: "route",
        to: "/admin/sms-activations",
        label: "SMS cảnh báo",
        desc: "Kích hoạt SMS và số điện thoại nhận cảnh báo",
        icon: PhoneCall,
      },
      {
        type: "route",
        to: "/admin/sms-service",
        label: "Quản lý SMS & Code",
        desc: "Theo dõi quota, tạo code và quản lý gói SMS",
        icon: TicketPercent,
      },
    ],
  },
  {
    title: "LT5GEO & dữ liệu",
    eyebrow: "Forward",
    items: [
      {
        type: "route",
        to: "/admin/lt5geo",
        label: "LT5GEO",
        desc: "Theo dõi dữ liệu và vị trí LT5GEO",
        icon: BarChart3,
        end: true,
      },
      {
        type: "route",
        to: "/admin/lt5/profiles",
        label: "LT5 Profiles",
        desc: "Tra cứu profile LT5 theo team",
        icon: IdCard,
      },
      {
        type: "route",
        to: "/admin/lt5/create-shipment",
        label: "Create Shipment",
        desc: "Tạo chuyến hàng LT5GEO mới",
        icon: PlusCircle,
      },
      {
        type: "route",
        to: "/admin/reading-archive",
        label: "Kho dữ liệu",
        desc: "Tra cứu và xuất dữ liệu logger cũ",
        icon: Database,
      },
      {
    type: "route",
    to: "/admin/logtag-webhook",
    label: "LogTag Webhook",
    desc: "Quản lý webhook realtime và subscription thiết bị",
    icon: Webhook,
      },
    ],
  },
];

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

const AdminSidebar: React.FC<AdminSidebarProps> = ({
  activeSection,
  setActiveSection,
  onLogout,
  setShowRegModal,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const sidebarRef = useRef<HTMLElement | null>(null);

  const filteredGroups = useMemo(() => {
    const q = normalizeText(query);
    if (!q) return groups;

    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          const text = normalizeText(`${group.title} ${group.eyebrow} ${item.label} ${item.desc}`);
          return text.includes(q);
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [query]);

  const closeMobile = () => setIsOpen(false);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 1024) setIsOpen(false);
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const sidebar = sidebarRef.current;
      const hamburger = document.querySelector(".hamburger-menu");

      if (
        isOpen &&
        sidebar &&
        hamburger &&
        !sidebar.contains(e.target as Node) &&
        !hamburger.contains(e.target as Node)
      ) {
        closeMobile();
      }
    };

    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [isOpen]);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;

    if (!isOpen || window.innerWidth > 1024) {
      html.classList.remove("admin-mobile-menu-open");
      body.classList.remove("admin-mobile-menu-open");
      return;
    }

    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevBodyTouchAction = body.style.touchAction;

    html.classList.add("admin-mobile-menu-open");
    body.classList.add("admin-mobile-menu-open");
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.touchAction = "none";

    return () => {
      html.classList.remove("admin-mobile-menu-open");
      body.classList.remove("admin-mobile-menu-open");
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      body.style.touchAction = prevBodyTouchAction;
    };
  }, [isOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMobile();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (section: SectionType) => {
    setActiveSection(section);
    closeMobile();
  };

  const handleOpenRegisterModal = () => {
    setShowRegModal?.(true);
    closeMobile();
  };

  const handleLogout = () => {
    closeMobile();
    onLogout();
  };

  return (
    <>
      <button
        className="hamburger-menu"
        onClick={() => setIsOpen((s) => !s)}
        aria-label={isOpen ? "Đóng menu" : "Mở menu"}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls="admin-sidebar"
        type="button"
      >
        {isOpen ? <X size={22} /> : <Menu size={24} />}
      </button>

      {isOpen && <div className="menu-overlay" onClick={closeMobile} aria-hidden="true" />}

      <nav
        ref={sidebarRef}
        id="admin-sidebar"
        className={`admin-sidebar ${isOpen ? "menu-open" : ""}`}
        data-state={isOpen ? "open" : "closed"}
        aria-label="Menu quản trị"
      >
        <div className="sidebar-orbit" aria-hidden="true" />

        <div className="sidebar-brand">
          <div className="brand-badge">
            <img src="/Pictures/logo.png" alt="SmartTech Logo" className="brand-logo" />
          </div>

          <div className="brand-text">
            <span className="brand-kicker">Mission Control</span>
            <h3>SMARTTECH</h3>
            <p>Quản trị vận hành • Admin</p>
          </div>
        </div>

        <div className="sidebar-command-card">
          <div className="command-icon"><Sparkles size={18} /></div>
          <div>
            <b>Ready to move forward</b>
            <span>Điều phối nhanh, dữ liệu rõ, thao tác gọn.</span>
          </div>
        </div>

        <label className="sidebar-search" htmlFor="admin-sidebar-search">
          <Search size={16} aria-hidden="true" />
          <input
            id="admin-sidebar-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm chức năng..."
            autoComplete="off"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Xóa tìm kiếm">
              <X size={14} />
            </button>
          )}
        </label>

        <div className="sidebar-scrollzone">
          {filteredGroups.length === 0 ? (
            <div className="sidebar-empty">
              <ShieldCheck size={20} />
              <span>Không tìm thấy chức năng phù hợp.</span>
            </div>
          ) : (
            filteredGroups.map((group) => (
              <section className="sidebar-group" key={group.title}>
                <div className="sidebar-group-title">
                  <span className="dot" aria-hidden="true" />
                  <div>
                    <span>{group.title}</span>
                    <small>{group.eyebrow}</small>
                  </div>
                </div>

                <ul className="sidebar-list">
                  {group.items.map((item) => {
                    const Icon = item.icon;

                    if (item.type === "local") {
                      const active = activeSection === item.key;
                      return (
                        <li key={String(item.key)}>
                          <button
                            type="button"
                            className={`sidebar-btn ${active ? "active" : ""}`}
                            onClick={() => go(item.key)}
                            aria-current={active ? "page" : undefined}
                          >
                            <span className="sb-icon" aria-hidden="true"><Icon size={18} /></span>
                            <span className="sb-copy">
                              <span className="sb-label">{item.label}</span>
                              <span className="sb-desc">{item.desc}</span>
                            </span>
                            <ChevronRight className="sb-arrow" size={16} aria-hidden="true" />
                          </button>
                        </li>
                      );
                    }

                    return (
                      <li key={item.to}>
                        <NavLink
                          to={item.to}
                          end={item.end}
                          className={({ isActive }) =>
                            `sidebar-btn as-link ${isActive ? "active" : ""}`
                          }
                          onClick={closeMobile}
                        >
                          <span className="sb-icon" aria-hidden="true"><Icon size={18} /></span>
                          <span className="sb-copy">
                            <span className="sb-label">{item.label}</span>
                            <span className="sb-desc">{item.desc}</span>
                          </span>
                          <ChevronRight className="sb-arrow" size={16} aria-hidden="true" />
                        </NavLink>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>

        <div className="sidebar-footer-actions">
          {setShowRegModal && (
            <button type="button" className="sidebar-btn register-btn" onClick={handleOpenRegisterModal}>
              <span className="sb-icon" aria-hidden="true"><PlusCircle size={18} /></span>
              <span className="sb-copy">
                <span className="sb-label">Đăng ký thiết bị</span>
                <span className="sb-desc">Thêm thiết bị LogTag mới vào team</span>
              </span>
              <ChevronRight className="sb-arrow" size={16} aria-hidden="true" />
            </button>
          )}

          <button type="button" className="sidebar-btn logout-btn" onClick={handleLogout}>
            <span className="sb-icon" aria-hidden="true"><LogOut size={18} /></span>
            <span className="sb-copy">
              <span className="sb-label">Đăng xuất</span>
              <span className="sb-desc">Thoát phiên quản trị hiện tại</span>
            </span>
          </button>
        </div>
      </nav>
    </>
  );
};

export default AdminSidebar;
