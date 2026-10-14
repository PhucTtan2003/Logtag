import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import api from "../../../../api/axios";
import { userIdHeader } from "../../../../utils/http";
import { sanitizeRechartsForPrint } from "../../../../utils/pdf/sanitizeRechartsForPrint";
import { buildPdfLayout } from "../../../../components/pdf/buildPdfLayout";
import { LiveWindow } from "../../../../types/liveWindow";

type PdfArgs = {
  selectedDevice: string;
  liveMode: boolean;
  liveWindow: LiveWindow;
  fromUtc: string;
  toUtc: string;
  fromLocal: string;
  toLocal: string;
  tMin: number;
  tMax: number;
  hMin: number;
  hMax: number;
  chartPanel?: HTMLElement | null;
};

/** ================= Excel ================= */
export async function exportExcel(args: {
  selectedDevice: string;
  fromUtc: string;
  toUtc: string;
  fromLocal: string;
  toLocal: string;
}) {
  const { selectedDevice, fromUtc, toUtc, fromLocal, toLocal } = args;
  if (!selectedDevice) return alert("⚠️ Vui lòng chọn thiết bị.");
  if (new Date(fromUtc) >= new Date(toUtc))
    return alert("⚠️ 'Từ' phải nhỏ hơn 'Đến'.");

  const url = "/api/export/excel-by-serial-range";
  const response = await api.get(url, {
    params: { serialNumber: selectedDevice, from: fromUtc, to: toUtc },
    responseType: "blob",
    headers: { ...userIdHeader() },
  });

  const blob = new Blob([response.data]);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.setAttribute(
    "download",
    `logtag_${selectedDevice}_${fromLocal.replace(/[:T]/g, "-")}_${toLocal.replace(
      /[:T]/g,
      "-"
    )}.xlsx`
  );
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

/** ================= PDF ================= */
export async function exportPDF({
  selectedDevice,
  liveMode,
  liveWindow,
  fromUtc,
  toUtc,
  fromLocal,
  toLocal,
  tMin,
  tMax,
  hMin,
  hMax,
  chartPanel,
}: PdfArgs) {
  const panel =
    chartPanel || (document.querySelector(".chart-box-panel") as HTMLElement | null);
  if (!panel) return;

  const deviceLabel = selectedDevice || "(chưa chọn)";
  const subtitle = liveMode
    ? `Realtime ${liveWindow}`
    : `${new Date(fromUtc).toLocaleString()} → ${new Date(
        toUtc
      ).toLocaleString()}`;

  const pdfDom = buildPdfLayout({
    title: `LogTag Report • ${deviceLabel}`,
    subtitle,
    meta: [
      { label: "Serial", value: deviceLabel },
      { label: "Ngưỡng T(°C)", value: "Min 15°C • Max 30°C" },
      { label: "Ngưỡng H(%)", value: "Min 30% • Max 70%" },
    ],
    stats: [
      { label: "T Min", value: `${tMin.toFixed(1)}°C` },
      { label: "T Max", value: `${tMax.toFixed(1)}°C` },
      { label: "H Min", value: `${hMin.toFixed(1)}%` },
      { label: "H Max", value: `${hMax.toFixed(1)}%` },
    ],
    chartNode: panel,
    logoUrl: "/Pictures/logo.png",
    watermarkText: "SmartTech • Smarter Solutions",
  });

  sanitizeRechartsForPrint(pdfDom);

  await new Promise((r) =>
    requestAnimationFrame(() => setTimeout(r, 60))
  );

  const capW = Math.ceil(pdfDom.scrollWidth);
  const capH = Math.ceil(pdfDom.scrollHeight);

  const scale = Math.min(2.5, window.devicePixelRatio || 2);
  const canvas = await html2canvas(pdfDom, {
    backgroundColor: "#ffffff",
    scale,
    useCORS: true,
    logging: false,
    width: capW,
    height: capH,
    windowWidth: capW,
    windowHeight: capH,
    scrollX: 0,
    scrollY: 0,
    removeContainer: true,
  });

  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "pt",
    format: "a4",
    compress: true,
  });

  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 18;

  const targetW = pageW - margin * 2;
  const targetH = pageH - margin * 2;
  const scaleW = targetW / canvas.width;
  const pageSliceHeight = Math.floor(targetH / scaleW);

  const pages: HTMLCanvasElement[] = [];
  for (let y = 0; y < canvas.height; y += pageSliceHeight) {
    const slice = document.createElement("canvas");
    slice.width = canvas.width;
    slice.height = Math.min(pageSliceHeight, canvas.height - y);
    slice
      .getContext("2d")!
      .drawImage(
        canvas,
        0,
        y,
        canvas.width,
        slice.height,
        0,
        0,
        canvas.width,
        slice.height
      );
    pages.push(slice);
  }

  pages.forEach((cv, idx) => {
    if (idx > 0) pdf.addPage();
    const w = targetW;
    const h = (cv.height * w) / cv.width;
    pdf.addImage(
      cv.toDataURL("image/png", 0.95),
      "PNG",
      margin,
      (pageH - h) / 2,
      w,
      h,
      undefined,
      "FAST"
    );
    pdf.setFontSize(9);
    pdf.text(`${idx + 1} / ${pages.length}`, pageW - margin - 24, pageH - 10);
  });

  const file = `chart_${deviceLabel.replace(/[^\w-]+/g, "")}_${
    liveMode
      ? liveWindow
      : fromLocal.replace(/[:T]/g, "-") + "_" + toLocal.replace(/[:T]/g, "-")
  }.pdf`;

  pdf.save(file);
  pdfDom.remove();
}
