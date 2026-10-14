import * as signalR from "@microsoft/signalr";

/** Join group theo nhiều tên method khác nhau, ưu tiên JoinSerial(serial) */
export async function joinSerialGroup(conn: signalR.HubConnection, serialRaw: string) {
  const serial = (serialRaw || "").trim();
  const room = `serial:${serial.toUpperCase()}`;

  const tryInvoke = async (m: string, arg: any) => {
    try { await conn.invoke(m, arg); return true; } catch { return false; }
  };

  if (await tryInvoke("JoinSerial", serial)) return console.log("[SignalR] joined via JoinSerial", serial);
  if (await tryInvoke("JoinGroup", room))    return console.log("[SignalR] joined via JoinGroup", room);
  if (await tryInvoke("Join", room))         return console.log("[SignalR] joined via Join", room);

  console.warn("[SignalR] no join method found — vẫn nghe broadcast global nếu có.");
}