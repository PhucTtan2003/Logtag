// YYYY-MM-DD HH:mm:ss (24h, zero-pad)
export const formatYMDHMS = (date: Date, timeZone?: string): string => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
};

export const tzShort = (date: Date): string =>
  new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
    .formatToParts(date)
    .find(p => p.type === "timeZoneName")?.value ?? "";

// for request body
export const toIsoSeconds = (d?: Date) => (d ? d.toISOString().slice(0, 19) : undefined);

// “x phút/giờ/ngày trước”
export const relTime = (isoUtc: string): string => {
  const t = new Date(isoUtc).getTime();
  const d = Date.now() - t;
  const sec = Math.max(0, Math.floor(d / 1000));
  const min = Math.floor(sec / 60), hr = Math.floor(min / 60), day = Math.floor(hr / 24);
  if (day > 0) return `${day} ngày trước`;
  if (hr > 0)  return `${hr} giờ trước`;
  if (min > 0) return `${min} phút trước`;
  return `${sec} giây trước`;
};
