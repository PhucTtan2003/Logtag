import React, { useMemo, useState } from "react";
import { LtgeoReading } from "../../models/LtgeoReadings";
import "../../styles/Ltgeo/LT5Table.css";

interface Props {
  readings: LtgeoReading[];
}

type SortDir = "asc" | "desc" | null;

const Lt5ReadingsTable: React.FC<Props> = ({ readings }) => {
  const [tempSortDir, setTempSortDir] = useState<SortDir>(null);

  // ⚠️ Hook luôn ở trên, không return trước khi gọi hook
  const sortedReadings = useMemo(() => {
    if (!readings || readings.length === 0) return [];

    if (!tempSortDir) return readings;

    const clone = [...readings];

    clone.sort((a, b) => {
      const ta = a.temperature ?? 0;
      const tb = b.temperature ?? 0;
      if (tempSortDir === "asc") return ta - tb;
      return tb - ta;
    });

    return clone;
  }, [readings, tempSortDir]);

  // Sau khi đã gọi xong hook, giờ mới được return
  if (!sortedReadings || sortedReadings.length === 0) {
    return <div className="lt5-table-empty">Không có dữ liệu.</div>;
  }

  const toggleTempSort = () => {
    setTempSortDir((prev) =>
      prev === null ? "asc" : prev === "asc" ? "desc" : null
    );
  };

  const renderTempSortIcon = () => {
    if (tempSortDir === "asc") return " ▲";
    if (tempSortDir === "desc") return " ▼";
    return "";
  };

  return (
    <div className="lt5-table-wrapper">
      <table className="lt5-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Thời gian (UTC)</th>

            {/* Cột nhiệt độ có sort */}
            <th
              className="sortable-col"
              onClick={toggleTempSort}
              title="Click để sắp xếp theo nhiệt độ"
            >
              Nhiệt độ (°C)
              <span className="sort-icon">{renderTempSortIcon()}</span>
            </th>

            <th>Độ ẩm (%)</th>
            <th>Lux</th>
            <th>Shock</th>
            <th>Lat</th>
            <th>Lng</th>
          </tr>
        </thead>

        <tbody>
          {sortedReadings.map((r, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>{r.dateUtc}</td>
              <td>{r.temperature}</td>
              <td>{r.humidity ?? "-"}</td>
              <td>{r.lux ?? "-"}</td>
              <td>{r.shock ?? "-"}</td>
              <td>{r.latitude ?? "-"}</td>
              <td>{r.longitude ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default Lt5ReadingsTable;