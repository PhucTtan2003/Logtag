    import jsPDF from "jspdf";
import html2canvas from "html2canvas";

/**
 * Xuất PDF từ một DOM element (bảng, div, panel, ...)
 * Nếu element cao hơn 1 trang A4 → tự chia thành nhiều trang.
 */
export async function exportElementToPdf(
  element: HTMLElement,
  fileName: string
) {
  // Chụp element full height
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    scrollX: 0,
    scrollY: -window.scrollY, // tránh bị ảnh hưởng scroll hiện tại
  });

  const imgData = canvas.toDataURL("image/png");

  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  // Tính kích thước ảnh theo chiều ngang trang
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = 0;

  pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
  heightLeft -= pageHeight;

  // Nếu còn phần ảnh “dư” xuống dưới → thêm trang mới
  while (heightLeft > 0) {
    position -= pageHeight;
    pdf.addPage();
    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }

  pdf.save(fileName);
}