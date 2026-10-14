// src/layouts/UserLayout.tsx
import React, { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Menu } from "lucide-react";
import UserSidebar from "../components/SideBar/UserSidebar";
import "../styles/User/UserPage.css";
import "../styles/User/UserSidebar.css";

export default function UserLayout() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("logtag:user-sidebar-collapsed") === "1"; }
    catch { return false; }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  useEffect(() => {
    try { localStorage.setItem("logtag:user-sidebar-collapsed", collapsed ? "1" : "0"); } catch {}
    window.dispatchEvent(new Event("resize"));
  }, [collapsed]);

  return (
    <div className="user-root--friendly us-layout">
      <div className={`uf-app-shell us-shell${collapsed ? " uf-app-shell--collapsed" : ""}${mobileOpen ? " uf-app-shell--mobile-open" : ""}`}>
        <UserSidebar collapsed={collapsed} mobileOpen={mobileOpen} onToggleCollapsed={() => setCollapsed(x => !x)} onCloseMobile={() => setMobileOpen(false)}/>
        <div className="us-layout-content">
          <div className="us-mobile-bar"><button type="button" onClick={() => setMobileOpen(true)} aria-label="Mở menu"><Menu size={21}/></button><strong>SmartTech Cloud</strong></div>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
