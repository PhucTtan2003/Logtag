import React from "react";

export default function ChartStats({
  tMin, tMax, hMin, hMax
}: { tMin: number; tMax: number; hMin: number; hMax: number; }) {
  return (
    <div className="chart-stats-mini">
      <div className="stat-chip">🌡️ T Min: <b>{tMin.toFixed(1)}°C</b></div>
      <div className="stat-chip">🌡️ T Max: <b>{tMax.toFixed(1)}°C</b></div>
      <div className="stat-chip">💧 H Min: <b>{hMin.toFixed(1)}%</b></div>
      <div className="stat-chip">💧 H Max: <b>{hMax.toFixed(1)}%</b></div>
    </div>
  );
}