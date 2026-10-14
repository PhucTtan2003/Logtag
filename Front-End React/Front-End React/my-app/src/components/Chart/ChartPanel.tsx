import React from 'react';
import ChartBox from '../Chart/ChartBox';
import '../../styles/Chart/ChartPanel.css';

type ChartPanelProps = {
  /** Serial mặc định khi mở trang (lấy từ URL) */
  defaultSerial?: string;
  /** Danh sách serial được phép xem (Admin: /api/devices/all) */
  allowedSerials?: string[];
  /** Optional layout props */
  className?: string;
  title?: React.ReactNode;
  actions?: React.ReactNode;
};

export default function ChartPanel({
  defaultSerial,
  allowedSerials,
  className,
  title,
  actions,
}: ChartPanelProps) {
  return (
    <section className={["grid-container", className].filter(Boolean).join(" ")}>
      {(title || actions) && (
        <header className="chartpanel-header">
          <div className="chartpanel-title">{title}</div>
          <div className="chartpanel-actions">{actions}</div>
        </header>
      )}
      <div className="box">
        <ChartBox defaultSerial={defaultSerial} allowedSerials={allowedSerials} />
      </div>
    </section>
  );
}
