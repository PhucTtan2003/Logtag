// src/components/User/UserSidebar.tsx
import React from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { AlarmClock, ChartNoAxesCombined, ChevronLeft, ChevronRight, FileClock, Gauge, House, LogOut, MessageSquare, Package, RadioTower, ShieldAlert, Tag, Thermometer, X } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import FeatureGate from "../FeatureGate";

interface Props {
  collapsed: boolean;
  mobileOpen: boolean;
  onToggleCollapsed: () => void;
  onCloseMobile: () => void;
}

export default function UserSidebar({ collapsed, mobileOpen, onToggleCollapsed, onCloseMobile }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();
  const go = (path: string) => { onCloseMobile(); navigate(path); };
  const action = (panel: string) => go(`/user?panel=${encodeURIComponent(panel)}`);
  const at = (path: string) => location.pathname === path;
  const item = (icon: React.ReactNode, label: string, onClick: () => void, active = false, disabled = false) => (
    <button type="button" className={`uf-nav-item${active ? " is-active" : ""}`} onClick={onClick} title={label} aria-current={active ? "page" : undefined} disabled={disabled}>
      {icon}<span>{label}</span>
    </button>
  );
  return (
    <>
      {mobileOpen && <button className="uf-nav-scrim" aria-label="Đóng menu" onClick={onCloseMobile} />}
      <aside className="uf-sidebar us-sidebar" aria-label="Điều hướng User">
        <div className="uf-sidebar-brand">
          <img src="/Pictures/logo.png" alt="SmartTech" />
          {!collapsed && <div><strong>SmartTech</strong><small>LogTag Monitoring</small></div>}
          <button type="button" className="uf-sidebar-close" aria-label="Đóng menu" onClick={onCloseMobile}><X size={20}/></button>
        </div>
        <nav className="uf-sidebar-nav" aria-label="Menu chính">
          <span className="uf-sidebar-caption">GIÁM SÁT</span>
          {item(<House size={19}/>, "Tổng quan", () => action("monitor"), at("/user") && new URLSearchParams(location.search).get("panel") !== "subscription")}
          {item(<ChartNoAxesCombined size={19}/>, "Biểu đồ nhiệt độ", () => action("monitor"))}
          {item(<RadioTower size={19}/>, "Trạng thái realtime", () => go("/realtime-status"), at("/realtime-status"))}
          {item(<ShieldAlert size={19}/>, "Sự kiện & cảnh báo", () => go("/events"), at("/events"))}
          <FeatureGate need="advanced_devices" fallback={item(<Gauge size={19}/>, "Thiết bị LTGEO 🔒", () => {}, false, true)}>
            {item(<Gauge size={19}/>, "Thiết bị LTGEO", () => go("/lt5"), at("/lt5"))}
          </FeatureGate>
          <span className="uf-sidebar-caption">THIẾT LẬP & BÁO CÁO</span>
          {item(<Thermometer size={19}/>, "Ngưỡng cảnh báo", () => action("threshold"))}
          {item(<Tag size={19}/>, "Đặt tên thiết bị", () => action("device-names"))}
          <FeatureGate need="sms_alert" fallback={item(<MessageSquare size={19}/>, "SMS cảnh báo 🔒", () => {}, false, true)}>
            {item(<MessageSquare size={19}/>, "SMS cảnh báo", () => action("sms"))}
          </FeatureGate>
          <FeatureGate need="sms_schedule" fallback={item(<FileClock size={19}/>, "SMS định kỳ 🔒", () => {}, false, true)}>
            {item(<FileClock size={19}/>, "SMS định kỳ", () => action("sms-schedule"))}
          </FeatureGate>
          {item(<FileClock size={19}/>, "Báo cáo tháng", () => action("monthly-report"))}
          {item(<AlarmClock size={19}/>, "Báo thức kiểm tra", () => action("alarm"))}
          {item(<Package size={19}/>, "Gói dịch vụ", () => action("subscription"))}
        </nav>
        <div className="uf-sidebar-footer">
          {item(<LogOut size={19}/>, "Đăng xuất", () => { onCloseMobile(); logout(); localStorage.removeItem("token"); navigate("/", { replace: true }); })}
          <button type="button" className="uf-collapse-btn" onClick={onToggleCollapsed} aria-label={collapsed ? "Mở rộng menu" : "Thu gọn menu"}>
            {collapsed ? <ChevronRight size={18}/> : <ChevronLeft size={18}/>}<span>{collapsed ? "" : "Thu gọn menu"}</span>
          </button>
        </div>
      </aside>
    </>
  );
}
