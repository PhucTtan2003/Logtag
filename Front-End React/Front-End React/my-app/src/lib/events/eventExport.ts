// src/lib/events/eventExport.ts
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import type { DbEvent } from "./types";
import { humanText } from "./classify";
import { formatYMDHMS } from "./format";

export type EventExportMeta = {
  serialNumber: string;
  startUtc: Date;
  endUtc: Date;
};

type BrandTheme = {
  companyName: string;
  reportTitle: string;
  departmentLine: string;
  footerNote: string;
  primary: string;
  secondary: string;
  soft: string;
  logoText: string;
  /**
   * Đặt logo thật trong public, ví dụ public/logo-smarttech.png,
   * rồi đổi thành "/logo-smarttech.png".
   * Để trống sẽ dùng badge chữ logoText.
   */
  logoUrl: string;
};

const BRAND: BrandTheme = {
  companyName: "SMARTTECH LOGTAG",
  reportTitle: "BÁO CÁO SỰ KIỆN THIẾT BỊ",
  departmentLine: "Hệ thống giám sát thiết bị • Nhật ký cảnh báo và sự kiện",
  footerNote: "Tài liệu được xuất tự động từ hệ thống LogTag Event Page.",
  primary: "#111827",
  secondary: "#0e7490",
  soft: "#f0f9ff",
  logoText: "ST",
  logoUrl: "",
};

const PDF_ROWS_PER_PAGE = 12;
const RENDER_WIDTH_PX = 1400;
const RENDER_HEIGHT_PX = 900;

function validDate(value: unknown): Date | null {
  if (!value) return null;
  const d = new Date(value as any);
  return Number.isFinite(d.getTime()) ? d : null;
}

function formatUtcPlus7(value: unknown): string {
  const d = validDate(value);
  if (!d) return "—";

  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}

function formatUtc(value: unknown): string {
  const d = validDate(value);
  return d ? `${formatYMDHMS(d, "UTC")} UTC` : "—";
}

function cleanRepeatText(input?: string | null): string {
  if (!input) return "";

  return String(input)
    .replace(/\s*,?\s*lặp\s+\d+\s+lần\.?/gi, "")
    .replace(/\s*,?\s*lập\s+\d+\s+lần\.?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function safeFilePart(value: string): string {
  return (
    String(value || "events")
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "events"
  );
}

function dayPart(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function buildFileName(meta: EventExportMeta, ext: "xlsx" | "pdf"): string {
  return (
    [
      "LogTag-events",
      safeFilePart(meta.serialNumber),
      dayPart(meta.startUtc),
      "to",
      dayPart(meta.endUtc),
    ].join("_") + `.${ext}`
  );
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export function buildEventExportRows(events: DbEvent[]) {
  return events
    .slice()
    .sort((a, b) => +new Date(a.eventTimeUtc) - +new Date(b.eventTimeUtc))
    .map((event, index) => {
      const info = humanText(event);

      return {
        STT: index + 1,
        "Thời gian UTC+7": formatUtcPlus7(event.eventTimeUtc),
        "Thời gian UTC": formatUtc(event.eventTimeUtc),
        "Thiết bị": String(event.serialNumber || ""),
        "Loại sự kiện": String(event.eventType || "info"),
        "Sự kiện": String(info.title || ""),
        "Diễn giải": cleanRepeatText(info.detail || ""),
      };
    });
}

export function exportEventsToExcel(
  events: DbEvent[],
  meta: EventExportMeta
): void {
  const rows = buildEventExportRows(events);

  const summaryRows = [
    [BRAND.reportTitle],
    ["Đơn vị", BRAND.companyName],
    ["Bộ phận", BRAND.departmentLine],
    ["Thiết bị", meta.serialNumber],
    ["Từ (UTC+7)", formatUtcPlus7(meta.startUtc)],
    ["Đến (UTC+7)", formatUtcPlus7(meta.endUtc)],
    ["Tổng sự kiện", rows.length],
    ["Xuất lúc (UTC+7)", formatUtcPlus7(new Date())],
  ];

  const workbook = XLSX.utils.book_new();
  const dataSheet = XLSX.utils.json_to_sheet(rows);
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);

  dataSheet["!cols"] = [
    { wch: 8 },
    { wch: 22 },
    { wch: 22 },
    { wch: 20 },
    { wch: 26 },
    { wch: 28 },
    { wch: 60 },
  ];

  summarySheet["!cols"] = [{ wch: 24 }, { wch: 42 }];

  XLSX.utils.book_append_sheet(workbook, summarySheet, "Thông tin");
  XLSX.utils.book_append_sheet(workbook, dataSheet, "Sự kiện");

  XLSX.writeFile(workbook, buildFileName(meta, "xlsx"), {
    compression: true,
  });
}

function buildLogoHtml(): string {
  if (BRAND.logoUrl.trim()) {
    return `
      <div class="brand-logo brand-logo--image">
        <img src="${escapeHtml(BRAND.logoUrl)}" alt="Logo" />
      </div>`;
  }

  return `<div class="brand-logo">${escapeHtml(BRAND.logoText)}</div>`;
}

function buildPdfPageHtml(
  rows: ReturnType<typeof buildEventExportRows>,
  meta: EventExportMeta,
  pageNumber: number,
  pageCount: number,
  totalRows: number
): string {
  const bodyRows = rows
    .map(
      (row) => `
        <tr>
          <td class="center">${escapeHtml(row.STT)}</td>
          <td class="mono">${escapeHtml(row["Thời gian UTC+7"])}</td>
          <td class="mono serial">${escapeHtml(row["Thiết bị"])}</td>
          <td>${escapeHtml(row["Loại sự kiện"])}</td>
          <td class="event-title">${escapeHtml(row["Sự kiện"])}</td>
          <td>${escapeHtml(row["Diễn giải"] || "-")}</td>
        </tr>`
    )
    .join("");

  return `
    <section class="pdf-page">
      <header class="brand-header">
        ${buildLogoHtml()}
        <div class="brand-copy">
          <div class="company-name">${escapeHtml(BRAND.companyName)}</div>
          <h1>${escapeHtml(BRAND.reportTitle)}</h1>
          <div class="department-line">${escapeHtml(BRAND.departmentLine)}</div>
        </div>
        <div class="report-code">LOGTAG EVENT REPORT</div>
      </header>

      <div class="meta-grid">
        <div class="meta-card">
          <span>Thiết bị</span>
          <strong>${escapeHtml(meta.serialNumber)}</strong>
        </div>
        <div class="meta-card">
          <span>Từ ngày</span>
          <strong>${escapeHtml(formatUtcPlus7(meta.startUtc))}</strong>
        </div>
        <div class="meta-card">
          <span>Đến ngày</span>
          <strong>${escapeHtml(formatUtcPlus7(meta.endUtc))}</strong>
        </div>
        <div class="meta-card">
          <span>Tổng sự kiện</span>
          <strong>${totalRows}</strong>
        </div>
      </div>

      <div class="table-shell">
        <table>
          <thead>
            <tr>
              <th class="center">STT</th>
              <th>Thời gian UTC+7</th>
              <th>Thiết bị</th>
              <th>Loại sự kiện</th>
              <th>Sự kiện</th>
              <th>Diễn giải</th>
            </tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>

      <footer class="brand-footer">
        <span>${escapeHtml(BRAND.footerNote)}</span>
        <span>Xuất lúc ${escapeHtml(formatUtcPlus7(new Date()))} UTC+7</span>
        <strong>Trang ${pageNumber}/${pageCount}</strong>
      </footer>
    </section>`;
}

function createRenderHost(): HTMLDivElement {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.position = "absolute";
  host.style.left = "-100000px";
  host.style.top = "0";
  host.style.width = `${RENDER_WIDTH_PX}px`;
  host.style.pointerEvents = "none";
  host.style.background = "#ffffff";
  document.body.appendChild(host);
  return host;
}

function getPdfPageCss(): string {
  return `
    * { box-sizing: border-box; }
    .pdf-page {
      width: ${RENDER_WIDTH_PX}px;
      height: ${RENDER_HEIGHT_PX}px;
      padding: 34px 38px 24px;
      background: #ffffff;
      color: ${BRAND.primary};
      font-family: Arial, "Segoe UI", "Noto Sans", sans-serif;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .brand-header {
      min-height: 126px;
      border-radius: 22px;
      padding: 22px 26px;
      background: linear-gradient(125deg, ${BRAND.primary}, #172554);
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 22px;
      position: relative;
      overflow: hidden;
    }
    .brand-header::after {
      content: "";
      position: absolute;
      right: -35px;
      top: -65px;
      width: 230px;
      height: 230px;
      border-radius: 999px;
      background: rgba(14, 116, 144, 0.28);
    }
    .brand-logo {
      width: 82px;
      height: 82px;
      flex: 0 0 82px;
      border-radius: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: ${BRAND.secondary};
      color: #ffffff;
      font-size: 32px;
      font-weight: 900;
      letter-spacing: 1px;
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.22);
      overflow: hidden;
    }
    .brand-logo--image { background: #ffffff; padding: 8px; }
    .brand-logo img { width: 100%; height: 100%; object-fit: contain; }
    .brand-copy { min-width: 0; position: relative; z-index: 1; }
    .company-name {
      font-size: 17px;
      font-weight: 800;
      letter-spacing: 0.8px;
      opacity: 0.94;
    }
    h1 {
      margin: 7px 0 5px;
      font-size: 29px;
      line-height: 1.1;
      letter-spacing: 0.3px;
    }
    .department-line { font-size: 15px; opacity: 0.82; }
    .report-code {
      margin-left: auto;
      align-self: flex-start;
      position: relative;
      z-index: 1;
      padding: 8px 12px;
      border: 1px solid rgba(255,255,255,.25);
      border-radius: 999px;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: .8px;
      white-space: nowrap;
      background: rgba(255,255,255,.08);
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
      margin: 18px 0;
    }
    .meta-card {
      min-height: 72px;
      padding: 13px 16px;
      border: 1px solid #cbd5e1;
      border-radius: 15px;
      background: ${BRAND.soft};
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .meta-card span {
      color: #64748b;
      font-size: 12px;
      font-weight: 700;
      margin-bottom: 6px;
    }
    .meta-card strong {
      color: ${BRAND.primary};
      font-size: 16px;
      line-height: 1.15;
      overflow-wrap: anywhere;
    }
    .table-shell {
      flex: 1;
      min-height: 0;
      border: 1px solid #cbd5e1;
      border-radius: 14px;
      overflow: hidden;
      background: #ffffff;
    }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td {
      border-right: 1px solid #dbe3ec;
      border-bottom: 1px solid #e2e8f0;
      padding: 9px 10px;
      text-align: left;
      vertical-align: top;
      overflow-wrap: anywhere;
    }
    th:last-child, td:last-child { border-right: none; }
    thead th {
      background: ${BRAND.secondary};
      color: #ffffff;
      font-size: 12px;
      font-weight: 800;
      line-height: 1.2;
    }
    tbody td {
      font-size: 11.5px;
      line-height: 1.28;
      color: #1e293b;
    }
    tbody tr:nth-child(even) td { background: #f8fafc; }
    th:nth-child(1), td:nth-child(1) { width: 5%; }
    th:nth-child(2), td:nth-child(2) { width: 15%; }
    th:nth-child(3), td:nth-child(3) { width: 15%; }
    th:nth-child(4), td:nth-child(4) { width: 17%; }
    th:nth-child(5), td:nth-child(5) { width: 18%; }
    th:nth-child(6), td:nth-child(6) { width: 30%; }
    .center { text-align: center; }
    .mono { font-family: Consolas, "Courier New", monospace; }
    .serial { font-weight: 700; }
    .event-title { font-weight: 700; }
    .brand-footer {
      min-height: 38px;
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px solid #e2e8f0;
      color: #64748b;
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 18px;
      align-items: center;
      font-size: 11px;
    }
    .brand-footer strong { color: ${BRAND.primary}; }
  `;
}

/**
 * Xuất PDF trực tiếp và giữ đúng tiếng Việt.
 * Cách này render báo cáo bằng HTML/CSS thành ảnh trước khi đưa vào PDF,
 * nên không phụ thuộc font mặc định của jsPDF.
 */
export async function exportEventsToPdf(
  events: DbEvent[],
  meta: EventExportMeta
): Promise<void> {
  const rows = buildEventExportRows(events);
  if (!rows.length) {
    throw new Error("Không có sự kiện để xuất PDF.");
  }

  const chunks = chunkArray(rows, PDF_ROWS_PER_PAGE);
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
    compress: true,
  });

  const host = createRenderHost();
  const style = document.createElement("style");
  style.textContent = getPdfPageCss();
  host.appendChild(style);

  try {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }

    for (let pageIndex = 0; pageIndex < chunks.length; pageIndex += 1) {
      const page = document.createElement("div");
      page.innerHTML = buildPdfPageHtml(
        chunks[pageIndex],
        meta,
        pageIndex + 1,
        chunks.length,
        rows.length
      );
      host.appendChild(page);

      const pageElement = page.firstElementChild as HTMLElement | null;
      if (!pageElement) {
        throw new Error("Không dựng được trang PDF.");
      }

      const canvas = await html2canvas(pageElement, {
        scale: 1.6,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
        width: RENDER_WIDTH_PX,
        height: RENDER_HEIGHT_PX,
        windowWidth: RENDER_WIDTH_PX,
        windowHeight: RENDER_HEIGHT_PX,
      });

      if (pageIndex > 0) {
        doc.addPage("a4", "landscape");
      }

      const pdfWidth = doc.internal.pageSize.getWidth();
      const pdfHeight = doc.internal.pageSize.getHeight();
      const imageData = canvas.toDataURL("image/jpeg", 0.92);
      doc.addImage(imageData, "JPEG", 0, 0, pdfWidth, pdfHeight, undefined, "FAST");

      page.remove();
    }

    doc.save(buildFileName(meta, "pdf"));
  } finally {
    host.remove();
  }
}
