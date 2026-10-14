// src/pages/User/ExportPage.tsx
import React, { useMemo, useState } from "react";
import {
  Download,
  Filter,
  FileSpreadsheet,
  FileText,
  FilePieChart,
  ArrowLeft,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import FeatureGate from "../../components/FeatureGate";

type Format = "csv" | "xlsx" | "pdf";

const ExportPage: React.FC = () => {
  const navigate = useNavigate();

  // Bộ lọc demo
  const [from, setFrom] = useState<string>(
    () => new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10)
  );
  const [to, setTo] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [device, setDevice] = useState<string>("");
  const [onlyAlarms, setOnlyAlarms] = useState<boolean>(false);

  // Dữ liệu mock để export thử
  const rows = useMemo(
    () => [
      {
        time: "2025-10-02 08:00",
        serial: "LT-ABC123",
        temp: 4.2,
        humi: 68,
        note: "OK",
      },
      {
        time: "2025-10-02 08:05",
        serial: "LT-ABC123",
        temp: 8.7,
        humi: 70,
        note: "⚠ High temp",
      },
    ],
    []
  );

  const onExport = async (fmt: Format) => {
    // 👉 Khi có API thật:
    // const q = new URLSearchParams({
    //   from, to, device, onlyAlarms: String(onlyAlarms),
    // });
    // const res = await fetch(`/api/export/${fmt}?` + q.toString());
    // const blob = await res.blob(); downloadBlob(blob, `export_${from}_${to}.${fmt}`);

    // Demo: tạo file giả để tải về
    if (fmt === "csv" || fmt === "xlsx") {
      const header = "Time,Serial,Temp,Humidity,Note\n";
      const body = rows
        .map((r) => `${r.time},${r.serial},${r.temp},${r.humi},${r.note}`)
        .join("\n");
      const blob = new Blob([header + body], {
        type: "text/csv;charset=utf-8",
      });
      // demo vẫn xuất .csv
      downloadBlob(blob, `logtag_export_${from}_${to}.csv`);
      return;
    }
    if (fmt === "pdf") {
      // PDF tối giản (demo). Thực tế dùng html2canvas + jsPDF để in bảng đẹp.
      const pdfText = `%PDF-1.1\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF`;
      const blob = new Blob([pdfText], { type: "application/pdf" });
      downloadBlob(blob, `logtag_export_${from}_${to}.pdf`);
      return;
    }
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  };

  return (
    <FeatureGate
      need="advanced_export"
      fallback={
        <div className="export-locked">
          <h1>🔒 Advanced Export</h1>
          <p>
            Bạn chưa được mở khoá tính năng này. Nâng cấp gói <b>PRO</b> hoặc{" "}
<b>PREMIUM</b> để sử dụng.
          </p>
          <button className="btn-secondary" onClick={() => navigate(-1)}>
            <ArrowLeft size={16} /> Quay lại
          </button>
        </div>
      }
    >
      <div className="export-root">
        {/* HEADER */}
        <div className="export-header">
          <button className="btn-secondary" onClick={() => navigate(-1)}>
            <ArrowLeft size={16} /> Quay lại
          </button>

          {/* Logo + Tiêu đề */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <img
              src="/Pictures/logo.png"
              alt="Company Logo"
              style={{ width: 50, height: 50, borderRadius: 8 }}
            />
            <div>
              <h1 className="export-title">Advanced Export</h1>
              <p className="export-sub">
                Xuất dữ liệu thiết bị với bộ lọc nâng cao và nhiều định dạng.
              </p>
            </div>
          </div>
        </div>

        {/* Bộ lọc */}
        <div className="export-filter">
          <div className="filter-title">
            <Filter size={16} /> Bộ lọc
          </div>
          <div className="filter-grid">
            <label className="field">
              <span>Từ ngày</span>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Đến ngày</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Thiết bị (Serial)</span>
              <input
                placeholder="VD: LT-ABC123"
                value={device}
                onChange={(e) => setDevice(e.target.value)}
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={onlyAlarms}
                onChange={(e) => setOnlyAlarms(e.target.checked)}
              />
              Chỉ lấy bản ghi có cảnh báo
            </label>
          </div>
        </div>

        {/* Cards lựa chọn định dạng */}
        <div className="export-cards">
          <div className="export-card">
            <FileSpreadsheet size={34} />
            <h3>Excel (XLSX)</h3>
            <p>Tải dữ liệu chi tiết ra Excel để phân tích/báo cáo.</p>
            <button className="btn-primary" onClick={() => onExport("xlsx")}>
              <Download size={16} /> Tải Excel
            </button>
          </div>

          <div className="export-card">
            <FileText size={34} />
            <h3>CSV</h3>
<p>Tương thích hầu hết hệ thống; dễ nhập vào BI/ETL.</p>
            <button className="btn-primary" onClick={() => onExport("csv")}>
              <Download size={16} /> Tải CSV
            </button>
          </div>

          <div className="export-card">
            <FilePieChart size={34} />
            <h3>PDF</h3>
            <p>Xuất báo cáo nhanh gọn, sẵn sàng để chia sẻ hoặc in ấn.</p>
            <button className="btn-primary" onClick={() => onExport("pdf")}>
              <Download size={16} /> Tải PDF
            </button>
          </div>
        </div>

        <div className="export-footer">
          ⚡ Mẹo: lọc phạm vi ngày hẹp để tải nhanh hơn. Khi cần dữ liệu lớn, nên
          dùng CSV.
        </div>
      </div>
    </FeatureGate>
  );
};

export default ExportPage;