// src/hooks/useEmployeeLogic.ts
import { useEffect, useMemo, useRef, useState } from "react";
import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
} from "@microsoft/signalr";
import api from "../api/axios";

interface Notification {
  notificationId: string;
  title: string;
  message: string;
  sentAt: string;
  isRead: boolean;
  sentTo: string | null;
  status: string; // "Hoàn thành" | "Đang xử lý"
}

interface WarrantyItem {
  title: string;
  content: string;
  createdAt: string;
  deviceId?: string;
}

export interface EmployeeInfo {
  fullName: string;
  email: string;
  phone: string;
  address: string;
  createAt: string;
  roleName: string;
  isActive: boolean;
}

// Chỉ truyền accountId (24 hex)
export function useEmployeeLogic(accountId: string) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [warrantyList, setWarrantyList] = useState<WarrantyItem[] | null>(null);
  const [unseenWarrantyCount, setUnseenWarrantyCount] = useState(0);
  const [employeeInfo, setEmployeeInfo] = useState<EmployeeInfo | null>(null);

  // =============== COMMON GUARDS ===============
  const validAccountId = useMemo(
    () => !!accountId && /^[a-f\d]{24}$/i.test(accountId),
    [accountId]
  );
  const headers = useMemo(
    () => (validAccountId ? { accountId } : {}),
    [validAccountId, accountId]
  );

  // =============== 1) EMPLOYEE INFO ===============
  useEffect(() => {
    if (!validAccountId) return;
    let ignore = false;
    api
      .get(`/api/employee/info/${accountId}`, { headers })
      .then((res) => { if (!ignore) setEmployeeInfo(res.data); })
      .catch(() => { if (!ignore) setEmployeeInfo(null); });
    return () => { ignore = true; };
  }, [validAccountId, accountId, headers]);

  // =============== 2) NOTIFICATIONS ===============
  useEffect(() => {
    if (!validAccountId) return;
    let ignore = false;
    api
      .get(`/api/employee/notifications/${accountId}`, { headers })
      .then((res) => { if (!ignore) setNotifications(res.data); })
      .catch(() => {});
    return () => { ignore = true; };
  }, [validAccountId, accountId, headers]);

  // =============== 3) UNSEEN WARRANTY COUNT ===============
  useEffect(() => {
    if (!validAccountId) return;
    let ignore = false;
    api
      .get(`/api/warranty/unseen-count/${accountId}`, { headers })
      .then((res) => { if (!ignore) setUnseenWarrantyCount(res.data?.count ?? 0); })
      .catch(() => {});
    return () => { ignore = true; };
  }, [validAccountId, accountId, headers]);

  // =============== 4) SIGNALR (NEGOTIATION-SAFE) ===============
  const connectionRef = useRef<HubConnection | null>(null);
  const startPromiseRef = useRef<Promise<void> | null>(null);
  const shouldStopRef = useRef(false);
  const startedForAccountRef = useRef<string | null>(null);

  useEffect(() => {
    if (!validAccountId) return;

    const baseUrl =
      (import.meta as any).env?.VITE_API_BASE_URL ||
      (process as any).env?.REACT_APP_API_BASE_URL ||
      "";

    // Nếu accountId đổi, dừng kết nối cũ (nếu có) trước khi tạo mới
    if (startedForAccountRef.current && startedForAccountRef.current !== accountId) {
      const prev = connectionRef.current;
      connectionRef.current = null;
      startPromiseRef.current = null;
      shouldStopRef.current = false;
      if (prev && prev.state !== HubConnectionState.Disconnected) {
        // dừng an toàn, không “stop during negotiation”
        (async () => {
          try {
            if (prev.state === HubConnectionState.Connecting) {
              await new Promise((r) => setTimeout(r, 100)); // nhường vòng lặp ngắn
            }
            if (prev.state !== HubConnectionState.Disconnected) {
              await prev.stop().catch(() => {});
            }
          } catch {}
        })();
      }
      startedForAccountRef.current = null;
    }

    // Nếu đã start cho accountId này rồi -> bỏ qua (StrictMode safe)
    if (startedForAccountRef.current === accountId) return;

    const conn = new HubConnectionBuilder()
      .withUrl(`${baseUrl.replace(/\/+$/, "")}/notificationHub?accountId=${accountId}`, {
        // ❌ KHÔNG ép skipNegotiation để tránh lỗi “stop during negotiation”
        // SignalR sẽ tự negotiate và chọn WebSockets khi có thể.
        withCredentials: true,
      })
      .configureLogging(LogLevel.Information)
      .withAutomaticReconnect([0, 2000, 5000, 10000])
      .build();

    connectionRef.current = conn;
    shouldStopRef.current = false;
    startedForAccountRef.current = accountId;

    // Handlers
    const onReceiveNotification = (notification: Notification) => {
      setNotifications((prev) => [notification, ...prev]);
    };
    const onReceiveWarranty = (warranty: WarrantyItem) => {
      setWarrantyList((prev) => (prev ? [warranty, ...prev] : [warranty]));
      setUnseenWarrantyCount((n) => n + 1);
    };
    conn.on("ReceiveNotification", onReceiveNotification);
    conn.on("ReceiveWarranty", onReceiveWarranty);

    // Start với promise được lưu lại để cleanup biết chờ
    const startPromise = conn.start()
      .then(() => {
        console.log("[SignalR] connected:", conn.connectionId ?? "(no id)");
      })
      .catch((err) => {
        console.error("[SignalR] start failed", err);
        // giữ state để cleanup vẫn xử lý được
      })
      .finally(async () => {
        // Nếu trong lúc start, component đã unmount → dừng sau khi start xong
        if (shouldStopRef.current && conn.state !== HubConnectionState.Disconnected) {
          try { await conn.stop(); } catch {}
        }
      });

    startPromiseRef.current = startPromise;

    // Reconnect logs (không cần off khi cleanup vì là method-based, không event name)
    conn.onreconnecting((err) => console.log("🟡 Reconnecting:", err?.message));
    conn.onreconnected(() => console.log("🟢 Reconnected:", conn.connectionId ?? "(no id)"));
    conn.onclose((err) => { if (err) console.warn("🔴 Connection closed:", err.message); });

    // Cleanup an toàn
    return () => {
      shouldStopRef.current = true; // báo là cần stop
      try {
        conn.off("ReceiveNotification", onReceiveNotification);
        conn.off("ReceiveWarranty", onReceiveWarranty);
      } catch {}

      // Nếu đang Connecting/Negotiating, chờ startPromise rồi stop
      if (conn.state === HubConnectionState.Connecting) {
        startPromiseRef.current
          ?.then(async () => {
            if (conn.state !== HubConnectionState.Disconnected) {
              try { await conn.stop(); } catch {}
            }
          })
          .catch(() => {});
      } else if (
        conn.state === HubConnectionState.Connected ||
        conn.state === HubConnectionState.Reconnecting
      ) {
        conn.stop().catch(() => {});
      }
    };
  }, [validAccountId, accountId]);

  // =============== 5) COMPUTED ===============
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  // =============== 6) UI HELPERS ===============
  const togglePopup = () => setIsOpen((o) => !o);

  // =============== 7) NOTIFICATION ACTIONS ===============
  const handleMarkAsRead = async (notificationId: string) => {
    if (!validAccountId) return;
    try {
      await api.post(
        `/api/employee/notifications/mark-read/${notificationId}/${accountId}`,
        {},
        { headers }
      );
      setNotifications((prev) =>
        prev.map((n) =>
          n.notificationId === notificationId ? { ...n, isRead: true } : n
        )
      );
    } catch {
      alert("Không thể đánh dấu đã đọc.");
    }
  };

  const handleMarkAllAsRead = async () => {
    if (!validAccountId) return;
    try {
      await api.post(`/api/employee/notifications/read-all/${accountId}`, {}, { headers });
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch {
      alert("Không thể đánh dấu tất cả là đã đọc.");
    }
  };

  const handleUpdateStatus = async (notificationId: string, newStatus: string) => {
    if (!validAccountId) return;
    try {
      await api.post(
        `/api/employee/notifications/${notificationId}/status`,
        { status: newStatus },
        { headers, withCredentials: true }
      );
      setNotifications((prev) =>
        prev.map((n) =>
          n.notificationId === notificationId ? { ...n, status: newStatus } : n
        )
      );
    } catch (error) {
      console.error("Lỗi cập nhật trạng thái:", error);
      alert("Không thể cập nhật trạng thái.");
    }
  };

  // =============== 8) WARRANTY ACTIONS ===============
  const handleOpenWarranties = async () => {
    if (!validAccountId) return;
    try {
      const res = await api.get(`/api/warranty/get-by-employee/${accountId}`, { headers });
      setWarrantyList(res.data);
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? "Không thể lấy yêu cầu bảo hành.";
      alert(msg);
    }
  };

  const handleMarkedSeen = async () => {
    if (!validAccountId) return;
    try {
      await api.put(`/api/warranty/mark-as-seen/${accountId}`, null, { headers });
      setUnseenWarrantyCount(0);
      // có thể reload danh sách nếu muốn:
      // await handleOpenWarranties();
    } catch {
      // không chặn UI
    }
  };

  return {
    notifications,
    isOpen,
    unreadCount,
    warrantyList,
    setWarrantyList,
    unseenWarrantyCount,
    togglePopup,
    handleMarkAsRead,
    handleMarkAllAsRead,
    handleOpenWarranties,
    handleMarkedSeen,
    handleUpdateStatus,
    employeeInfo,
  };
}