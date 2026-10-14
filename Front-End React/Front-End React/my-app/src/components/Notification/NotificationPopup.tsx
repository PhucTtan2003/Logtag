import React from "react";

interface Notification {
  notificationId: string;
  title: string;
  message: string;
  sentAt: string;
  isRead: boolean;
}

interface Props {
  notifications: Notification[];
  isOpen: boolean;
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
}

const NotificationPopup: React.FC<Props> = ({
  notifications,
  isOpen,
  onMarkAsRead,
  onMarkAllAsRead,
}) =>
  isOpen ? (
    <div className="notification-popup">
      <h3>🔔 Thông báo</h3>
      {notifications.some((n) => !n.isRead) && (
        <button
          className="text-xs px-2 py-1 bg-blue-100 text-blue-600 rounded hover:bg-blue-200 transition"
          onClick={onMarkAllAsRead}
        >
          Đánh dấu tất cả là đã đọc
        </button>
      )}
      {notifications.length > 0 ? (
        notifications.map((n) => (
          <div
            key={n.notificationId}
            className={`notification-item${n.isRead === false ? " unread" : ""}`}
            tabIndex={0}
          >
            <strong>{n.title}</strong>
            <p>{n.message}</p>
            <span>{new Date(n.sentAt).toLocaleDateString("vi-VN")}</span>
            {!n.isRead && (
              <>
                <span className="unread-dot"></span>
                <button
                  onClick={() => onMarkAsRead(n.notificationId)}
                  className="mark-read-btn"
                >
                  ✅ Đánh dấu đã đọc
                </button>
              </>
            )}
          </div>
        ))
      ) : (
        <p>Không có thông báo.</p>
      )}
    </div>
  ) : null;

export default NotificationPopup;