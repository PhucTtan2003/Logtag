import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../api/axios";
import "../../styles/Devices/DeviceGridPage.css";
import { HardDrive, Search, RefreshCw } from "lucide-react";
import { userIdHeader } from "../../utils/http"; // nếu không có utils này thì bỏ import + fallback

const ADMIN_API = "/api/devices/all";
const USER_API  = "/api/sensordata/GetDeviceSerials";

export default function DeviceGridPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [devices, setDevices] = useState<string[]>([]);
  const [q, setQ] = useState("");

  const fetchDevices = async () => {
    setLoading(true);
    try {
      // Admin: /api/devices/all trả về { data: string[], ... }
      const res = await api.get(ADMIN_API);
      const list: string[] = res.data?.data ?? res.data ?? [];
      setDevices(list);
    } catch {
      // Fallback cho user thường (đề phòng dùng chung component)
      try {
        const res2 = await api.get(USER_API, { headers: { ...userIdHeader() } });
        const list2: string[] = Array.isArray(res2.data) ? res2.data : [];
        setDevices(list2);
      } catch {
        setDevices([]);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDevices(); }, []);

  const filtered = useMemo(() => {
    const key = q.trim().toUpperCase();
    if (!key) return devices;
    return devices.filter(sn => (sn || "").toUpperCase().includes(key));
  }, [devices, q]);

  return (
    <div className="device-page">
      <header className="device-header">
        <div className="title-wrap">
          <HardDrive size={22} />
          <h2>Danh sách thiết bị</h2>
          <span className="count">({devices.length})</span>
        </div>

        <div className="tools">
          <div className="searchbox">
            <Search size={16} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm theo serial..."
              aria-label="Tìm thiết bị"
            />
          </div>
          <button className="btn-refresh" onClick={fetchDevices} disabled={loading}>
            <RefreshCw size={16} /> {loading ? "Đang tải..." : "Làm mới"}
          </button>
        </div>
      </header>

      <section className="device-grid">
        {loading && <div className="hint">Đang tải danh sách...</div>}
        {!loading && filtered.length === 0 && (
          <div className="hint">Không có thiết bị phù hợp.</div>
        )}

        {!loading && filtered.map((sn) => (
          <button
            key={sn}
            type="button"
            className="device-card"
            onClick={() => navigate(`/charts/${encodeURIComponent(sn)}`)}
            title={`Mở biểu đồ của ${sn}`}
          >
            <div className="card-head">
              <span className="chip">Serial</span>
            </div>
            <div className="serial">{sn}</div>
            <div className="meta">Bấm để xem biểu đồ</div>
          </button>
        ))}
      </section>
    </div>
  );
}

