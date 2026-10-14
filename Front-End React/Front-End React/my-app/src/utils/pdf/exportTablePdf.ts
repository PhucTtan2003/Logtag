// src/utils/pdf/exportTablePdf.ts
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { LtgeoReading } from "../../models/LtgeoReadings";

export interface TablePdfInfo {
  serial: string;
  timeRange: string;
}

/**
 * Xuất PDF dạng bảng dữ liệu (không dùng tiếng Việt có dấu
 * để tránh lỗi font của jsPDF default).
 */
export function exportTablePdf(
  readings: LtgeoReading[],
  fileName: string,
  info: TablePdfInfo
) {
  const doc = new jsPDF("p", "mm", "a4");
  const safeRange = info.timeRange.replace(/→/g, " to ");

  // ===== Header (không dấu / English để không bị vỡ font) =====
  doc.setFontSize(16);
  doc.text("LTGeo 5 Readings Table", 14, 14);

  doc.setFontSize(11);
  doc.text(`Serial: ${info.serial}`, 14, 22);
  doc.text(`Time range (UTC): ${safeRange}`, 14, 28);

  // ===== Table =====
  autoTable(doc, {
    startY: 34,
    head: [
      [
        "#",
        "Time (UTC)",
        "Temperature (C)",
        "Humidity (%)",
        "Lux",
        "Shock",
        "Lat",
        "Lng",
      ],
    ],
    body: readings.map((r, i) => [
      i + 1,
      r.dateUtc,
      r.temperature,
      r.humidity ?? "-",
      r.lux ?? "-",
      r.shock ?? "-",
      r.latitude ?? "-",
      r.longitude ?? "-",
    ]),
    styles: {
      fontSize: 9,
      cellPadding: 2,
    },
    headStyles: {
      fillColor: [52, 152, 219], // header xanh
      textColor: 255,
    },
  });

  doc.save(fileName);
}