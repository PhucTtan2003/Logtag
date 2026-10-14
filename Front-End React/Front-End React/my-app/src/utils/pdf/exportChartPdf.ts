    import html2canvas from "html2canvas";
import jsPDF from "jspdf";

// Lấy type chuẩn từ file buildPdfLayout.ts
import {
  buildPdfLayout,
  type BuildPdfLayoutInput,
} from "../../components/pdf/buildPdfLayout";

import { sanitizeRechartsForPrint } from "./sanitizeRechartsForPrint";

/**
 * Tham số export chart:
 *  - toàn bộ field của BuildPdfLayoutInput (title, subtitle, meta, stats, chartNode, ...)
 *  - cộng thêm fileName để save PDF
 */
export interface ExportChartOptions extends BuildPdfLayoutInput {
  fileName: string;
}

export async function exportChartPdf(options: ExportChartOptions) {
  const { fileName, ...layoutOptions } = options;

  // 1) Dựng DOM layout tạm cho PDF (header + meta + stats + chart clone)
  const wrapper = buildPdfLayout(layoutOptions);

  // 2) Làm sạch Recharts (ẩn brush, tooltip, data-print-hide, v.v.)
  sanitizeRechartsForPrint(wrapper);

  try {
    // 3) Chụp wrapper bằng html2canvas
    const canvas = await html2canvas(wrapper, {
      scale: 2,
      useCORS: true,
    });

    const imgData = canvas.toDataURL("image/png");

    // 4) Tạo PDF A4 ngang và chèn ảnh vào
    const pdf = new jsPDF("landscape", "mm", "a4");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    pdf.addImage(imgData, "PNG", 0, 0, pageWidth, pageHeight);

    // 5) Lưu file
    pdf.save(fileName);
  } finally {
    // 6) Dọn DOM tạm
    wrapper.remove();
  }
}