import React from "react";
import "../styles/Chart/ChartBox.css";

export default function LoadingOverlay() {
  return (
    <div className="chart-loading" role="status" aria-live="polite">
      <div className="spinner" />
      <div>Đang tải dữ liệu...</div>
    </div>
  );
}