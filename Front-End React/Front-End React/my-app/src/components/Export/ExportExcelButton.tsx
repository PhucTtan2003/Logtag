import React, { useState } from "react";
import RangeExportDialog from "./RangeExportDialog";
import "../styles/Exports/RangeExportDialog.css";
import { exportExcel } from "../../pages/User/userchart/exports/exportExcel";

type Props = {
  /** Serial đang chọn; có thể chưa có */
  selectedSerial?: string | null;
};

const ExportExcelButton: React.FC<Props> = ({ selectedSerial }) => {
  const [open, setOpen] = useState(false);

  const canExport = !!selectedSerial;

  return (
    <>
      <button
        type="button"
        disabled={!canExport}
        onClick={() => setOpen(true)}
        style={{
          padding: "10px 14px",
          borderRadius: 10,
          border: 0,
          background: "#2563eb",
          color: "#fff",
          fontWeight: 700,
          opacity: canExport ? 1 : 0.6,
          cursor: canExport ? "pointer" : "not-allowed",
        }}
      >
        Xuất Excel
      </button>

      {/* Chỉ render dialog khi bấm nút (tránh render vô ích lúc chưa có serial) */}
      {open && (
        <RangeExportDialog
          open={open}
          // RangeExportDialog cần string bắt buộc → fallback rỗng cho an toàn kiểu
          serial={selectedSerial ?? ""}
          onClose={() => setOpen(false)}
          onConfirm={(fromIsoUtc, toIsoUtc) => {
            if (!selectedSerial) return; // guard runtime
            // fromIsoUtc/toIsoUtc là string từ dialog → dùng luôn
            exportExcel(selectedSerial, fromIsoUtc!, toIsoUtc!);
            setOpen(false);
          }}
        />
      )}
    </>
  );
};

export default ExportExcelButton;