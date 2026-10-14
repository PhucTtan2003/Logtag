import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import ChartPanel from '../../components/Chart/ChartPanel';
import '../../styles/Admin/ChartPage.css';
import { motion } from 'framer-motion';
import { BarChart3, ArrowLeft } from 'lucide-react';
import api from '../../api/axios';
import { userIdHeader } from '../../utils/http'; // nếu không có thì bỏ import + fallback

const ADMIN_API = "/api/devices/all";
const USER_API  = "/api/sensordata/GetDeviceSerials";

export default function ChartPage() {
  const { serial } = useParams<{ serial?: string }>();
  const [allowedSerials, setAllowedSerials] = useState<string[] | undefined>(undefined);

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const res = await api.get(ADMIN_API);
        const list: string[] = res.data?.data ?? res.data ?? [];
        if (!ignore) setAllowedSerials(list);
      } catch {
        // Fallback nếu không phải Admin
        try {
          const res2 = await api.get(USER_API, { headers: { ...userIdHeader() } });
          const list2: string[] = Array.isArray(res2.data) ? res2.data : [];
          if (!ignore) setAllowedSerials(list2);
        } catch {
          if (!ignore) setAllowedSerials([]);
        }
      }
    })();
    return () => { ignore = true; };
  }, []);

  return (
    <div className="chart-home-container">
      <main className="chart-main-content">
        <div className="chart-topbar">
          <Link to="/devices" className="backlink"><ArrowLeft size={16}/> Danh sách</Link>
        </div>

        {/* Tiêu đề */}
        <motion.h1
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="chart-title"
        >
          <BarChart3 size={30} /> Biểu đồ Thống Kê Thiết Bị {serial ? <>• <b>{serial}</b></> : null}
        </motion.h1>

        {/* Card chứa biểu đồ */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="chart-card-wrapper"
        >
          <ChartPanel
            defaultSerial={serial}
            allowedSerials={allowedSerials}
          />
        </motion.div>
      </main>
    </div>
  );
}