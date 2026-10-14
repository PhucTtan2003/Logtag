import type { DbEvent } from "./types";

export type Tone = "alarm" | "battery" | "neutral";

export const unitByAlarm = (t: string): string => {
  const s = (t || "").toLowerCase();
  if (s.includes("temperature")) return "°C";
  if (s.includes("humidity"))    return "%RH";
  if (s.includes("light"))       return "lx";
  if (s.includes("shock") || s.includes("vibration")) return "g";
  return "";
};

type Kind =
  | { type: "alarm"; sensor: "Temperature"|"Humidity"|"Light"|"Shock"|"Other" }
  | { type: "battery_low" }
  | { type: "conn_lost" }
  | { type: "conn_restored" }
  | { type: "power_lost" }
  | { type: "power_restored" }
  | { type: "other" };

export const classify = (eventType: string): Kind => {
  const norm = (eventType || "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const has = (w: string) => norm.includes(w);

  if (has("connection") && has("lost")) return { type: "conn_lost" };
  if (has("connection") && (has("restored") || has("restore") || has("recovered")))
    return { type: "conn_restored" };

  if (has("power") && (has("lost") || has("loss") || has("failure"))) return { type: "power_lost" };
  if (has("power") && (has("restored") || has("restore") || has("recovered"))) return { type: "power_restored" };

  if (has("battery") && (has("low") || has("critical"))) return { type: "battery_low" };

  if (has("alarm")) {
    if (has("temperature")) return { type: "alarm", sensor: "Temperature" };
    if (has("humidity"))    return { type: "alarm", sensor: "Humidity"    };
    if (has("light"))       return { type: "alarm", sensor: "Light"       };
    if (has("shock") || has("vibration")) return { type: "alarm", sensor: "Shock" };
    return { type: "alarm", sensor: "Other" };
  }
  return { type: "other" };
};

// Text ngắn cho list/table
export const humanText = (e: DbEvent): { icon: string; tone: Tone; title: string; detail: string } => {
  const k = classify(e.eventType);
  switch (k.type) {
    case "alarm": {
      const unit = unitByAlarm(e.eventType);
      const val = e.alarmValue !== undefined ? `${e.alarmValue}${unit}` : "—";
      const thr = e.alarmThreshold !== undefined ? `${e.alarmThreshold}${unit}` : "—";
      const times = e.alarmCount ?? 1;
      const title =
        k.sensor === "Temperature" ? "Vượt ngưỡng nhiệt độ" :
        k.sensor === "Humidity"    ? "Vượt ngưỡng độ ẩm" :
        k.sensor === "Light"       ? "Vượt ngưỡng ánh sáng" :
        k.sensor === "Shock"       ? "Vượt ngưỡng rung/lực" :
                                     "Cảnh báo";
      return { icon:"⚠️", tone:"alarm", title, detail:`Giá trị ${val}, ngưỡng ${thr}, lặp ${times} lần` };
    }
    case "battery_low":
      return { icon:"🔋", tone:"battery", title:"Pin yếu", detail: e.batteryType || "Loại pin không rõ" };
    case "conn_lost":
      return { icon:"📡", tone:"neutral", title:"Mất kết nối", detail:"Thiết bị không liên lạc với máy chủ" };
    case "conn_restored":
      return { icon:"✅", tone:"neutral", title:"Đã khôi phục kết nối", detail:"Thiết bị kết nối lại thành công" };
    case "power_lost":
      return { icon:"⚡", tone:"neutral", title:"Mất nguồn ngoài", detail:"Nguồn cấp ngoài bị mất" };
    case "power_restored":
      return { icon:"⚡", tone:"neutral", title:"Nguồn ngoài đã khôi phục", detail:"Nguồn cấp ngoài hoạt động lại" };
    default:
      return { icon:"ℹ️", tone:"neutral", title: e.eventType || "Sự kiện", detail:"" };
  }
};

// Text giải thích chi tiết cho panel
export const humanExplain = (e: DbEvent) => {
  const k = classify(e.eventType);
  const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ""));
  const unit = unitByAlarm(e.eventType);

  if (k.type === "alarm") {
    const val = typeof e.alarmValue === "number" ? `${fmtNum(e.alarmValue)} ${unit}`.trim() : undefined;
    const thr = typeof e.alarmThreshold === "number" ? `${fmtNum(e.alarmThreshold)} ${unit}`.trim() : undefined;
    const times = typeof e.alarmCount === "number" ? `${e.alarmCount} lần` : undefined;

    const title =
      k.sensor === "Temperature" ? "Vượt ngưỡng nhiệt độ" :
      k.sensor === "Humidity"    ? "Vượt ngưỡng độ ẩm" :
      k.sensor === "Light"       ? "Vượt ngưỡng ánh sáng" :
      k.sensor === "Shock"       ? "Vượt ngưỡng rung/lực" :
                                   "Cảnh báo";

    const meaning = val && thr
      ? `Giá trị đo đạt ${val}, vượt ngưỡng thiết lập ${thr}${times ? `, lặp ${times}` : ""}.`
      : "Thiết bị phát hiện vượt ngưỡng đã thiết lập.";

    return {
      icon: "⚠️",
      tone: "alarm" as const,
      title,
      meaning,
      bullets: [
        val ? { k: "Giá trị đo", v: val } : null,
        thr ? { k: "Ngưỡng cảnh báo", v: thr } : null,
        times ? { k: "Số lần liên tiếp", v: times } : null,
      ].filter(Boolean) as {k:string; v:string}[]
    };
  }

  if (k.type === "battery_low") {
    return {
      icon: "🔋", tone: "battery" as const, title: "Pin yếu",
      meaning: "Mức pin thấp, cần thay/ sạc pin để đảm bảo thiết bị hoạt động ổn định.",
      bullets: e.batteryType ? [{ k: "Loại pin", v: e.batteryType }] : []
    };
  }

  if (k.type === "conn_lost") {
    return { icon:"📡", tone:"neutral" as const, title:"Mất kết nối",
      meaning:"Thiết bị ngừng liên lạc với máy chủ. Dữ liệu mới có thể không được gửi lên cho đến khi kết nối được khôi phục.",
      bullets: [] };
  }

  if (k.type === "conn_restored") {
    return { icon:"✅", tone:"neutral" as const, title:"Đã khôi phục kết nối",
      meaning:"Thiết bị đã kết nối lại máy chủ. Dữ liệu sẽ tiếp tục được cập nhật bình thường.",
      bullets: [] };
  }

  if (k.type === "power_lost") {
    return { icon:"⚡", tone:"neutral" as const, title:"Mất nguồn ngoài",
      meaning:"Nguồn cấp ngoài bị mất. Thiết bị có thể chuyển sang nguồn dự phòng (nếu có).",
      bullets: [] };
  }

  if (k.type === "power_restored") {
    return { icon:"⚡", tone:"neutral" as const, title:"Nguồn ngoài đã khôi phục",
      meaning:"Nguồn cấp ngoài hoạt động trở lại.",
      bullets: [] };
  }

  return { icon:"ℹ️", tone:"neutral" as const, title: e.eventType || "Sự kiện", meaning:"", bullets: [] };
};
