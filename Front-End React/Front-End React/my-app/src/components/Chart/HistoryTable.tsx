import React from "react";
import type { DataPoint } from "../../hooks/useSensorChartDataRange";

export default function HistoryTable({ data }: { data: DataPoint[] }) {
  return (
    <div className="history-table-wrap">
      <table className="history-table">
        <thead>
          <tr>
            <th>Thời gian (UTC)</th>
            <th>Nhiệt độ (°C)</th>
            <th>Độ ẩm (%RH)</th>
          </tr>
        </thead>
        <tbody>
          {data.map((p, i) => (
            <tr key={i}>
              <td>{new Date(p.time).toLocaleString()}</td>
              <td>{p.temperature?.toFixed(2)}</td>
              <td>{p.humidity?.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
