// src/components/pdf/buildPdfLayout.ts
// DOM layout dành cho html2canvas + jsPDF.
// Xong việc nhớ gọi pdfDom.remove() để dọn.

export type PdfMeta = { label: string; value: string };
export type PdfStat = { label: string; value: string };

export interface BuildPdfLayoutInput {
  title: string;
  subtitle?: string;
  meta?: PdfMeta[];
  stats?: PdfStat[];
  chartNode: HTMLElement;   // Panel chứa biểu đồ đang hiển thị trên UI
  logoUrl?: string;
  logoHeight?: number;
  watermarkText?: string;
}

/**
 * Ẩn/bỏ các lớp tương tác & defs/mask của Recharts trước khi chụp để tránh
 * “cục xanh”, brush, tooltip… và hiện tượng legend phóng đại.
 */
export function sanitizeRechartsForPrint(root: HTMLElement) {
  try {
    // 1) Ẩn lớp tương tác
    root.querySelectorAll<HTMLElement>(
      ".recharts-brush, .recharts-brush-traveller, .recharts-brush-slide," +
      " .recharts-tooltip-cursor, .recharts-tooltip-wrapper, .recharts-crosshair," +
      " .recharts-active-dot, .recharts-highlight"
    ).forEach(el => (el.style.display = "none"));

    // 2) Ẩn phần được đánh dấu là không in
    root.querySelectorAll<HTMLElement>("[data-print-hide='true']").forEach(el => {
      el.style.display = "none";
    });

    // 3) Xử lý trong từng svg
    root.querySelectorAll<SVGElement>("svg").forEach(svg => {
      // Loại defs/mask/clipPath/gradient để tránh vùng fill lạ
      svg.querySelectorAll("defs, mask, clipPath, pattern, linearGradient, radialGradient")
        .forEach(n => n.parentNode?.removeChild(n));

      // Khóa kích thước icon trong legend + bỏ fill (đề phòng phóng đại)
      svg.querySelectorAll<SVGElement>(".recharts-legend-wrapper svg, .recharts-legend-item svg").forEach(sv => {
        sv.setAttribute("width", "14");
        sv.setAttribute("height", "14");
        (sv.style as any).width = "14px";
        (sv.style as any).height = "14px";
      });
      svg.querySelectorAll<SVGElement>(".recharts-legend-item path, .recharts-legend-item circle, .recharts-legend-item rect")
        .forEach(el => {
          el.setAttribute?.("fill", "none");
          (el.style as any).fill = "none";
          if (!el.getAttribute("stroke")) el.setAttribute("stroke", "#333");
          if (!el.getAttribute("stroke-width")) el.setAttribute("stroke-width", "2");
        });

      // 4) Tắt fill trong vùng vẽ chính (giữ <text>, không động vào legend)
      const surface = svg.closest(".recharts-wrapper")?.querySelector(".recharts-surface") as SVGElement | null;
      if (surface) {
        surface.querySelectorAll<SVGElement>("*").forEach(el => {
          const tag = el.tagName.toLowerCase();
          if (tag === "text") return;
          if ((el.closest(".recharts-legend-wrapper") || el.closest(".recharts-legend-item"))) return;
          el.setAttribute?.("fill", "none");
          (el.style as any).fill = "none";
          (el.style as any).fillOpacity = "0";
        });
      }
    });
  } catch {}
}

export function buildPdfLayout({
  title,
  subtitle = "",
  meta = [],
  stats = [],
  chartNode,
  logoUrl,
  watermarkText,
  logoHeight = 100,
}: BuildPdfLayoutInput): HTMLDivElement {
  const BG_COLOR = "#f8fafc"; // màu nền khung chart (đồng bộ với UI)

  // ===== Wrapper =====
  const wrapper = document.createElement("div");
  wrapper.id = "__pdfroot";
  Object.assign(wrapper.style, {
    width: "1120px", // sẽ override theo chart thực
    padding: "18px 22px",
    background: "#ffffff",
    color: "#0f172a",
    fontFamily: "ui-sans-serif, Arial, Helvetica, system-ui, -apple-system",
    lineHeight: "1.35",
    boxSizing: "border-box",
    position: "fixed",
    left: "-99999px", // ra khỏi viewport
    top: "0",
    zIndex: "2147483647",
  } as CSSStyleDeclaration);

  const reset = document.createElement("style");
  reset.textContent = `
    #__pdfroot, #__pdfroot * { box-sizing: border-box; }

    /* giữ overflow để html2canvas thấy đầy đủ */
    #__pdfroot .recharts-wrapper { overflow: visible !important; }
    #__pdfroot svg { overflow: visible !important; }

    /* KHÓA icon legend để không phóng đại */
    #__pdfroot .recharts-legend-wrapper svg,
    #__pdfroot .recharts-legend-item svg {
      width: 14px !important;
      height: 14px !important;
    }
    #__pdfroot .recharts-legend-item path,
    #__pdfroot .recharts-legend-item circle,
    #__pdfroot .recharts-legend-item rect {
      fill: none !important;
      stroke-width: 2 !important;
    }

    /* nới các container biểu đồ */
    #__pdfroot .chart-box-panel,
    #__pdfroot .chart-container,
    #__pdfroot .chart-section,
    #__pdfroot [class*="chart-section"] {
      height: auto !important;
      max-height: none !important;
      max-width: none !important;
      overflow: visible !important;
    }
  `;
  wrapper.appendChild(reset);

  // ===== Header =====
  const header = document.createElement("div");
  Object.assign(header.style, {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: "10px",
    borderBottom: "1px solid rgba(15,23,42,0.08)",
    marginBottom: "12px",
  } as CSSStyleDeclaration);

  const hLeft = document.createElement("div");
  const hTitle = document.createElement("div");
  hTitle.textContent = title;
  Object.assign(hTitle.style, { fontSize: "20px", fontWeight: "700", margin: "0 0 2px 0" });
  const hSub = document.createElement("div");
  hSub.textContent = subtitle || "";
  Object.assign(hSub.style, { fontSize: "12.5px", color: "#475569", margin: "0" });
  hLeft.appendChild(hTitle);
  if (subtitle) hLeft.appendChild(hSub);

  const hRight = document.createElement("div");
  if (logoUrl) {
    const logo = document.createElement("img");
    logo.src = logoUrl;
    logo.alt = "Logo";
    Object.assign(logo.style, {
      height: `${logoHeight}px`,   // ✅ dùng logoHeight
      objectFit: "contain",
    } as CSSStyleDeclaration);
    hRight.appendChild(logo);
  }
  header.appendChild(hLeft);
  header.appendChild(hRight);
  wrapper.appendChild(header);

  // ===== Meta =====
  if (meta?.length) {
    const metaBox = document.createElement("div");
    Object.assign(metaBox.style, {
      display: "flex",
      flexWrap: "wrap",
      gap: "10px 18px",
      margin: "6px 0 8px",
      fontSize: "12.5px",
    } as CSSStyleDeclaration);
    for (const m of meta) {
      const item = document.createElement("div");
      item.innerHTML = `<b>${escapeHtml(m.label)}:</b> ${escapeHtml(m.value)}`;
      metaBox.appendChild(item);
    }
    wrapper.appendChild(metaBox);
  }

  // ===== Stats =====
  if (stats?.length) {
    const statsBox = document.createElement("div");
    Object.assign(statsBox.style, {
      display: "flex",
      flexWrap: "wrap",
      gap: "8px",
      margin: "2px 0 12px",
    } as CSSStyleDeclaration);
    for (const s of stats) {
      const chip = document.createElement("div");
      chip.textContent = `${s.label}: ${s.value}`;
      Object.assign(chip.style, {
        fontSize: "12.5px",
        padding: "6px 10px",
        background: "linear-gradient(180deg,#f8fafc,#eef2ff)",
        border: "1px solid rgba(15,23,42,0.08)",
        borderRadius: "10px",
        boxShadow: "0 1px 2px rgba(2,6,23,0.05)",
      } as CSSStyleDeclaration);
      statsBox.appendChild(chip);
    }
    wrapper.appendChild(statsBox);
  }

  // ===== Chart area =====
  const chartCard = document.createElement("div");
  Object.assign(chartCard.style, {
    background: BG_COLOR,
    border: "1px solid rgba(15,23,42,0.08)",
    borderRadius: "12px",
    padding: "12px",
    minHeight: "360px",
    position: "relative",
    overflow: "visible",
  } as CSSStyleDeclaration);

  // Đo kích thước thật từ DOM gốc
  const wrapOrig = chartNode.querySelector<HTMLElement>(".recharts-wrapper");
  const rect = wrapOrig?.getBoundingClientRect();
  const realW = Math.round(rect?.width ?? 0);
  const realH = Math.round(rect?.height ?? 0);

  // Clone chart nguyên cây
  const chartClone = chartNode.cloneNode(true) as HTMLElement;
  chartClone.classList.remove("glow-on-hover");
  chartClone.style.boxShadow = "none";
  chartClone.style.background = "transparent";
  chartClone.style.border = "none";
  chartClone.style.margin = "0";
  chartClone.style.width = "auto";
  chartClone.style.maxWidth = "none";
  chartClone.style.overflow = "visible";
  chartClone.querySelectorAll<HTMLElement>(
    ".chart-box-panel, .chart-container, .chart-section, [class*='chart-section']"
  ).forEach(el => {
    el.style.height = "auto";
    el.style.maxHeight = "none";
    el.style.maxWidth = "none";
    el.style.overflow = "visible";
  });

  // Ẩn lớp tương tác (brush/tooltip/active-dot…)
  chartClone.querySelectorAll<HTMLElement>(`
    .recharts-brush,
    .recharts-brush-traveller,
    .recharts-brush-slide,
    .recharts-tooltip-cursor,
    .recharts-tooltip-wrapper,
    .recharts-crosshair,
    .recharts-active-dot,
    .recharts-highlight
  `).forEach(el => (el.style.display = "none"));

  // Ghim size cho clone theo kích thước thật
  if (realW > 0 && realH > 0) {
    chartClone.querySelectorAll<HTMLElement>(".recharts-responsive-container").forEach(rc => {
      rc.style.width = `${realW}px`;
      rc.style.height = `${realH}px`;
      rc.style.minWidth = `${realW}px`;
      rc.style.minHeight = `${realH}px`;
      rc.style.overflow = "visible";
    });
    chartClone.querySelectorAll<HTMLElement>(".recharts-wrapper").forEach(wrap => {
      wrap.style.width = `${realW}px`;
      wrap.style.height = `${realH}px`;
      wrap.style.overflow = "visible";
      const svg = wrap.querySelector("svg") as SVGSVGElement | null;
      if (svg) {
        svg.setAttribute("width", String(realW));
        svg.setAttribute("height", String(realH));
        svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
        (svg.style as any).overflow = "visible";
      }
    });
  }

  // 🧹 DIỆT CỤC XANH: tắt fill trong vùng vẽ chính (giữ text), legend đã xử lý riêng
  const surface = chartClone.querySelector<SVGElement>(".recharts-surface");
  if (surface) {
    surface.querySelectorAll<SVGElement>("*").forEach((el) => {
      const tag = el.tagName.toLowerCase();
      if (tag === "text") return;
      if ((el.closest(".recharts-legend-wrapper") || el.closest(".recharts-legend-item"))) return;
      el.setAttribute?.("fill", "none");
      (el.style as any).fill = "none";
      (el.style as any).fillOpacity = "0";
    });
  }

  // Nền dài đúng chart + nới wrapper
  const PADX = 12;
  if (realW > 0) {
    chartCard.style.display = "inline-block";
    chartCard.style.width = `${realW + PADX * 2}px`;
    chartCard.style.maxWidth = "none";
    (wrapper.style as any).width = `${realW + PADX * 2 + 48}px`;
  }

  chartCard.appendChild(chartClone);
  wrapper.appendChild(chartCard);

  // ===== Footer =====
  const footer = document.createElement("div");
  footer.textContent = `Generated: ${new Date().toLocaleString()}`;
  Object.assign(footer.style, {
    fontSize: "11px",
    color: "#64748b",
    marginTop: "8px",
  } as CSSStyleDeclaration);
  wrapper.appendChild(footer);

  // ===== Watermark (tuỳ chọn) =====
  if (watermarkText) {
    const wm = document.createElement("div");
    wm.textContent = watermarkText;
    Object.assign(wm.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      fontSize: "64px",
      fontWeight: "700",
      color: "rgba(2,6,23,0.06)",
      transform: "rotate(-18deg)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      letterSpacing: "2px",
    } as CSSStyleDeclaration);
    chartCard.appendChild(wm);
  }

  document.body.appendChild(wrapper);
  return wrapper;
}

// ===== util =====
function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}