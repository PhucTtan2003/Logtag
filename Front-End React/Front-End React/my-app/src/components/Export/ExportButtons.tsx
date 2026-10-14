import React, { useState } from "react";
import { FileSpreadsheet, FileDown, RefreshCw } from "lucide-react";

//  modal chọn Từ/Đến (tạo file này nếu chưa có)
import RangeExportDialog from "./RangeExportDialog";
import "../../styles/Exports/RangeExportDialog.css";

// hàm export excel hiện đang nằm ở pages/User/userchart/exports/exportExcel.ts
import { exportExcel } from "../../pages/User/userchart/exports/exportExcel";

export default function ExportButtons({
  onExportExcel,
  onExportPDF,
  onRefresh,
  onSyncReadings,
  disabled,
  // Truyền serial đang chọn để bật popup Từ/Đến
  selectedSerial,
}: {
  onExportExcel: () => void;
  onExportPDF: () => void;
  onRefresh: () => void;
  onSyncReadings: () => void;
  disabled?: boolean;
  selectedSerial?: string; // <-- thêm prop mới, optional để không phá chỗ gọi cũ
}) {
  const [openExcel, setOpenExcel] = useState(false);

  const handleExcelClick = () => {
    // Nếu có serial → mở popup chọn Từ/Đến; nếu chưa truyền serial → giữ hành vi cũ
    if (selectedSerial) {
      setOpenExcel(true);
    } else {
      onExportExcel?.();
    }
  };

  return (
    <div className="export-buttons-modern">
      <button onClick={handleExcelClick} className="btn-excel ripple" disabled={disabled}>
        <FileSpreadsheet size={18} /> Xuất Excel
      </button>

      <button onClick={onExportPDF} className="btn-pdf ripple" disabled={disabled}>
        <FileDown size={18} /> Xuất PDF
      </button>

      <button onClick={onRefresh} className="btn-refresh" disabled={disabled}>
        🔄 Làm mới
      </button>

      {/* <button
        onClick={onSyncReadings}
        className="btn-refresh"
        disabled={disabled}
        title="Đồng bộ readings về DB"
      >
        <RefreshCw size={14} /> Đồng bộ readings
      </button> */}

      {/* ===== Modal chọn Từ/Đến cho Excel ===== */}
      {selectedSerial && (
        <RangeExportDialog
          open={openExcel}
          serial={selectedSerial}
          onClose={() => setOpenExcel(false)}
          onConfirm={(fromIsoUtc, toIsoUtc) => {
            if (!selectedSerial) return;
            // Gọi export Excel thực tế (đã có check ≤ 62 ngày ở FE + BE)
            exportExcel(selectedSerial, fromIsoUtc, toIsoUtc);
          }}
        />
      )}
    </div>
  );
}
