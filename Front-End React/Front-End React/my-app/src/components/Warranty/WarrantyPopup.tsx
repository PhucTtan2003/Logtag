import React from "react";
import "../../styles/Warranty/WarrantyPopup.css";
import api from "../../api/axios";
import Toast from "../../components/Toast";  

interface WarrantyItem {
  title: string;
  content: string;
  createdAt: string;
  deviceId?: string;
}

interface Props {
  data: WarrantyItem[];
  onClose: () => void;
  onMarkedSeen: () => void;
}

const WarrantyPopup: React.FC<Props> = ({ data, onClose, onMarkedSeen }) => {
  const employeeId = localStorage.getItem("accountId") || "";
  const [hasMarked, setHasMarked] = React.useState(false);
  const [toast, setToast] = React.useState<{ message: string; type: "success" | "error" } | null>(null);

  const handleMarkAllAsSeen = async () => {
    try {
      await api.put(`/api/warranty/mark-as-seen/${employeeId}`);
      setHasMarked(true);
      setToast({ message: "✅ Đã đánh dấu tất cả là đã xem", type: "success" });
      onMarkedSeen();
    } catch {
      setToast({ message: "❌ Không thể đánh dấu đã xem", type: "error" });
    }
  };

  return (
    <div className="warranty-popup-overlay">
      <div className="warranty-popup">
        <button className="close-btn" onClick={onClose}>
          ❌
        </button>
        <h2>🔧 Yêu cầu bảo hành của bạn</h2>

        {!hasMarked && (
          <button className="mark-btn" onClick={handleMarkAllAsSeen}>
            ✅ Đánh dấu tất cả là đã xem
          </button>
        )}

        <div className="popup-content">
          {data.length === 0 ? (
            <p className="no-warranty">Không có yêu cầu bảo hành.</p>
          ) : (
            data.map((item, index) => (
              <div key={index} className="warranty-item">
                <p>📦 <strong>Thiết bị:</strong> {item.deviceId}</p>
                <p>🌟 <strong>Tiêu đề:</strong> {item.title}</p>
                <p>📄 <strong>Nội dung:</strong> {item.content}</p>
                <p>⏰ <strong>Thời gian:</strong> {item.createdAt}</p>
              </div>
            ))
          )}
        </div>
      </div>

      {/* hiển thị toast */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
          durationMs={2000}
        />
      )}
    </div>
  );
};

export default WarrantyPopup;