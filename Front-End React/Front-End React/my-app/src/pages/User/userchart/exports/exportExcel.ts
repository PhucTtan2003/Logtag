// src/pages/User/userchart/exports/exportExcel.ts
import { API_BASE } from "../config";
import { getUserId } from "../utils/time";

const MAX_DAYS = 62;

/** Tính số ngày giữa 2 mốc UTC ISO */
function diffDays(aIso: string, bIso: string) {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  return Math.abs(b - a) / (1000 * 60 * 60 * 24);
}

export function exportExcel(selected: string, fromUtc: string, toUtc: string) {
  if (!selected) {
    alert("⚠️ Vui lòng chọn thiết bị.");
    return;
  }
  if (!fromUtc || !toUtc) {
    alert("⚠️ Thời gian chưa hợp lệ.");
    return;
  }
  if (new Date(fromUtc) >= new Date(toUtc)) {
    alert("⚠️ 'Từ' phải nhỏ hơn 'Đến'.");
    return;
  }
  if (diffDays(fromUtc, toUtc) > MAX_DAYS) {
    alert(`⚠️ Chỉ cho phép tối đa ${MAX_DAYS} ngày (≤ 2 tháng).`);
    return;
  }

  const tz = "Asia/Ho_Chi_Minh";
  const base = API_BASE || "";
  const url =
    `${base}/api/export/excel-by-serial-range` +
    `?serialNumber=${encodeURIComponent(selected)}` +
    `&from=${encodeURIComponent(fromUtc)}` +
    `&to=${encodeURIComponent(toUtc)}` +
    `&tz=${encodeURIComponent(tz)}`;

  const uid = getUserId();

  // Nếu chưa có uid → fallback mở tab mới (không có header auth)
  if (!uid) {
    window.open(url, "_blank");
    return;
  }

  fetch(url, {
    method: "GET",
    credentials: "include",
    headers: { "X-User-Id": uid },
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
      return res.blob();
    })
    .then((blob) => {
      const ts = new Date();
      const name = `export_${selected}_${ts
        .toISOString()
        .replace(/[:.]/g, "-")}.xlsx`;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = name;
      link.click();
      URL.revokeObjectURL(link.href);
    })
    .catch(() => {
      // Nếu fetch lỗi → fallback mở URL
      window.open(url, "_blank");
    });
}
