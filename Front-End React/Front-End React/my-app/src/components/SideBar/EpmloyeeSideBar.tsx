import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
  X,
  Gauge,
  BarChart2,
  ThermometerSun,
  ClipboardList,
  Bell,
  Users,
} from "lucide-react";
import "../../styles/Employee/Employee.css";

export type EmpSection =
  | "dashboard"
  | "chart"
  | "thresholds"
  | "tasks"
  | "notifications"
  | "assign";

type NavItem = {
  id: EmpSection;
  label: string;
  icon: React.ReactNode;
  badge?: number; // tuỳ chọn: số lượng (thông báo, công việc…)
  hotkey?: string; // gợi ý phím tắt (ví dụ: D, C, T…)
};

type Props = {
  open: boolean;
  setOpen: (v: boolean) => void;
  active: EmpSection;
  setActive: (s: EmpSection) => void;
  // tuỳ chọn: truyền số lượng để hiển thị badge
  taskCount?: number;
  notificationCount?: number;
};

const EmployeeSidebar: React.FC<Props> = ({
  open,
  setOpen,
  active,
  setActive,
  taskCount = 0,
  notificationCount = 0,
}) => {
  // Danh sách menu (có thể memo để tránh re-render)
  const items: NavItem[] = useMemo(
    () => [
      { id: "dashboard", label: "Tổng quan", icon: <Gauge size={18} />, hotkey: "D" },
      { id: "chart", label: "Biểu đồ", icon: <BarChart2 size={18} />, hotkey: "B" },
      {
        id: "thresholds",
        label: "Ngưỡng cảnh báo",
        icon: <ThermometerSun size={18} />,
        hotkey: "N",
      },
      {
        id: "tasks",
        label: "Công việc",
        icon: <ClipboardList size={18} />,
        badge: taskCount > 0 ? taskCount : undefined,
        hotkey: "V",
      },
      // {
      //   id: "notifications",
      //   label: "Thông báo",
      //   icon: <Bell size={18} />,
      //   badge: notificationCount > 0 ? notificationCount : undefined,
      //   hotkey: "T",
      // },
      {
        id: "assign",
        label: "Gán thiết bị cho User",
        icon: <Users size={18} />,
        hotkey: "G",
      },
    ],
    [taskCount, notificationCount]
  );

  // --- Keyboard navigation (↑/↓/Enter/Esc)
  const focusedIndex = useRef<number>(-1);
  const navRef = useRef<HTMLDivElement | null>(null);

  const setActiveByIndex = useCallback(
    (idx: number) => {
      const next = items[idx];
      if (!next) return;
      setActive(next.id);
      setOpen(false);
    },
    [items, setActive, setOpen]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open) return;
      const list = navRef.current?.querySelectorAll<HTMLButtonElement>(
        ".emp-sb__item"
      );
      const max = (list?.length || 0) - 1;
      if (!list || max < 0) return;

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          focusedIndex.current = Math.min(
            focusedIndex.current + 1,
            max
          );
          list[focusedIndex.current].focus();
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          focusedIndex.current = Math.max(
            focusedIndex.current - 1,
            0
          );
          list[focusedIndex.current].focus();
          break;
        }
        case "Enter": {
          e.preventDefault();
          if (focusedIndex.current >= 0) {
            setActiveByIndex(focusedIndex.current);
          }
          break;
        }
        case "Escape": {
          e.preventDefault();
          setOpen(false);
          break;
        }
        default:
          break;
      }
    },
    [open, setActiveByIndex, setOpen]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Khi mở drawer → reset focusedIndex
  useEffect(() => {
    focusedIndex.current = -1;
  }, [open]);

  const Item: React.FC<{ nav: NavItem; active: boolean; idx: number }> = ({
    nav,
    active,
    idx,
  }) => (
    <button
      className={`emp-sb__item ${active ? "is-active" : ""}`}
      onClick={() => {
        setActive(nav.id);
        setOpen(false);
      }}
      type="button"
      data-index={idx}
      aria-current={active ? "page" : undefined}
      aria-label={nav.label}
    >
      <span className="emp-sb__bullet" aria-hidden />
      <span className="emp-sb__icon">{nav.icon}</span>
      <span className="emp-sb__text">
        {nav.label}
        {nav.hotkey && <kbd className="emp-sb__kbd">{nav.hotkey}</kbd>}
      </span>
      {typeof nav.badge === "number" && (
        <span className="emp-sb__badge" aria-label={`${nav.badge} mục mới`}>
          {nav.badge > 99 ? "99+" : nav.badge}
        </span>
      )}
    </button>
  );

  return (
    <>
      {/* overlay */}
      <div
        className={`emp-sb__overlay ${open ? "show" : ""}`}
        onClick={() => setOpen(false)}
        aria-hidden={!open}
      />

      {/* drawer / rail */}
      <aside
        className={`emp-sb__drawer ${open ? "open" : ""}`}
        aria-hidden={!open}
        aria-label="Employee Menu"
      >
        <div className="emp-sb__head">
          <div className="emp-sb__brand">
            <div className="emp-sb__logo">ST</div>
            <div className="emp-sb__brandtext">
              <strong>SMARTTECH</strong>
              <span className="emp-sb__role">Employee</span>
            </div>
          </div>

          <button
            className="emp-sb__close"
            onClick={() => setOpen(false)}
            aria-label="Đóng"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="emp-sb__nav" ref={navRef} role="navigation">
          {items.map((it, i) => (
            <Item key={it.id} nav={it} active={active === it.id} idx={i} />
          ))}
        </nav>

        <div className="emp-sb__foot">
          <small>© {new Date().getFullYear()} SMARTTECH</small>
        </div>
      </aside>
    </>
  );
};

export default EmployeeSidebar;
