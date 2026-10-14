export function toUtcIsoForQuery(localValue: string) {
  if (!localValue) return "";
  const d = new Date(localValue);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();
}

export function toLocalInputValue(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function formatLocal(dt: Date) {
  return dt.toLocaleString([], { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}