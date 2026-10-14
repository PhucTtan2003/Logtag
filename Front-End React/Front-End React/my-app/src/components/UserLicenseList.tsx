// src/components/UserLicenseList.tsx
import React, { useEffect, useState } from "react";
import axios from "./../api/axios";
import "../styles/User/UserLicenseList.css";

type LicenseItem = {
  code: string;
  plan: string;
  features: string[];
  durationDays: number;
  redeemedAtUtc: string;
  expiresAtUtc: string;
  notes?: string;
};

const UserLicenseList: React.FC = () => {
  const [items, setItems] = useState<LicenseItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const res = await axios.get<{ items: LicenseItem[] }>(
          "/api/subscriptions/my-codes"
        );
        if (mounted) setItems(res.data.items || []);
      } catch (e) {
        console.error(e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  if (loading) return null;
  if (!items.length) return null;

  return (
    <div className="lic-wrapper">
      <h2 className="lic-title">🎟️ Mã gói dịch vụ đã kích hoạt</h2>

      <div className="lic-grid">
        {items.map((x) => (
          <div key={x.code} className="lic-card">
            <div className="lic-card-header">
              <span className="lic-code">{x.code}</span>
              <span className={`lic-plan lic-plan-${x.plan}`}>
                {x.plan.toUpperCase()}
              </span>
            </div>

            <div className="lic-row">
              <span className="lic-label">⏳ Thời hạn:</span>
              <span>{x.durationDays} ngày</span>
            </div>

            <div className="lic-row">
              <span className="lic-label">✨ Tính năng:</span>
              <span className="lic-features">
                {x.features.length ? x.features.join(", ") : "Không có"}
              </span>
            </div>

            <div className="lic-row">
              <span className="lic-label">Kích hoạt:</span>
              <span>{new Date(x.redeemedAtUtc).toLocaleDateString()}</span>
            </div>

            <div className="lic-row">
              <span className="lic-label">Hết hạn:</span>
              <span>{new Date(x.expiresAtUtc).toLocaleDateString()}</span>
            </div>

            {x.notes && (
              <div className="lic-notes">
                📝 <span>{x.notes}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default UserLicenseList;
