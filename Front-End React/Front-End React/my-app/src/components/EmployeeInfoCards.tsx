// src/components/EmployeeInfoCards.tsx
import React from "react";
import { User, Activity, ListChecks, PackageSearch } from "lucide-react";
import "../styles/Employee/Employee.css";

interface EmployeeInfo {
  fullName: string;
  email: string;
  phone: string;
  address: string;
  createAt?: string;
  createat?: string;
  createdAt?: string;
  roleName: string;
  isActive: boolean;
  _id?: any;
}

interface EmployeeInfoCardsProps {
  employeeInfo?: EmployeeInfo | null;
  onOpenWarranties: () => void;
  unseenWarrantyCount: number;
  realtimeData: any[];
  realtimeAlerts: any[];
}

/* ========= helpers ========= */
const fmtDateTime = (input?: any) => {
  if (!input) return "—";
  const date =
    input instanceof Date ? input : new Date(typeof input === "string" ? input : String(input));
  return isNaN(date.getTime()) ? "—" : date.toLocaleString("vi-VN", { hour12: false });
};

const pickCreatedAt = (info?: EmployeeInfo | null) => {
  if (!info) return "—";
  const raw =
    info.createAt ??
    (info as any).createat ?? 
    (info as any).createdAt ??
    null;

  if (raw) return fmtDateTime(raw);

  // Fallback: rút timestamp từ ObjectId nếu có
  const idVal =
    typeof info._id === "string"
      ? info._id
      : (info as any)?._id?.$oid ??
        (typeof (info as any)?._id === "object" ? (info as any)._id?.toString?.() : undefined);

  if (idVal && /^[a-f\d]{24}$/i.test(idVal)) {
    const tsMs = parseInt(idVal.substring(0, 8), 16) * 1000;
    return new Date(tsMs).toLocaleString("vi-VN", { hour12: false });
  }

  return "—";
};

/* ========= component ========= */
const EmployeeInfoCards: React.FC<EmployeeInfoCardsProps> = ({
  employeeInfo,
  onOpenWarranties,
  unseenWarrantyCount,
  realtimeData = [],
  realtimeAlerts = [],
}) => (
  <div className="info-cards">
    {/* Hồ sơ */}
    <div className="info-card">
      <User size={24} />
      <h4>Hồ sơ</h4>
      {employeeInfo ? (
        <div className="employee-info">
          <p>
            <strong>👤 Họ tên:</strong> {employeeInfo.fullName || "—"}
          </p>
          <p>
            <strong>📧 Email:</strong> {employeeInfo.email || "—"}
          </p>
          <p>
            <strong>📞 Điện thoại:</strong> {employeeInfo.phone || "—"}
          </p>
          <p>
            <strong>🏠 Địa chỉ:</strong> {employeeInfo.address || "—"}
          </p>
          <p>
            <strong>🔐 Vai trò:</strong> {employeeInfo.roleName || "—"}
          </p>
          <p>
            <strong>📅 Ngày tạo:</strong> {pickCreatedAt(employeeInfo)}
          </p>
          <p>
            <strong>✅ Trạng thái:</strong> {employeeInfo.isActive ? "Đang hoạt động" : "Bị khóa"}
          </p>
        </div>
      ) : (
        <p>Thông tin cá nhân nhân viên</p>
      )}
    </div>

    {/* Hoạt động */}
    <div className="info-card">
      <Activity size={24} />
      <h4>Hoạt động</h4>
      <p>Giám sát và kiểm tra thiết bị</p>

      {/* Realtime trong card */}
      <div className="realtime-inside-box">
        <h5>📡 Trạng thái thiết bị</h5>
        {realtimeData.length === 0 ? (
          <p className="muted">Không có thiết bị.</p>
        ) : (
          <ul>
            {realtimeData.map((d: any, idx: number) => (
              <li key={idx}>
                <strong>{d.serialNumber || d.name || d.notes || "Thiết bị"}</strong>:{" "}
                {d.temperature ?? "—"}°C - {d.humidity ?? "—"}% —{" "}
                <span style={{ color: d.status === "Offline" ? "red" : "green" }}>
                  {d.status ?? "Unknown"}
                </span>
              </li>
            ))}
          </ul>
        )}

        <h5>🚨 Cảnh báo</h5>
        {realtimeAlerts.length === 0 ? (
          <p>✅ Không có cảnh báo.</p>
        ) : (
          <ul>
            {realtimeAlerts.map((a: any, idx: number) => (
              <li key={idx}>
                <strong>{a.serialNumber || a.name || a.notes || "Thiết bị"}</strong>: {a.message} lúc{" "}
                {fmtDateTime(a.timeUtc ?? a.time)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>

    {/* Thông báo */}
    <div className="info-card">
      <ListChecks size={24} />
      <h4>Thông báo</h4>
      <p>Cập nhật cảnh báo tức thì</p>
      <button className="btn-warranty" onClick={onOpenWarranties}>
        <PackageSearch size={16} className="mr-1" />
        📦 Yêu cầu bảo hành
        {unseenWarrantyCount > 0 && (
          <span className="badge warranty-badge">{unseenWarrantyCount}</span>
        )}
      </button>
    </div>
  </div>
);

export default EmployeeInfoCards;