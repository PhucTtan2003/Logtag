import React from "react";

export default function SessionExpiredModal({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <h2>🚨 Phiên đăng nhập đã hết</h2>
        <p>Vui lòng đăng nhập lại để tiếp tục sử dụng hệ thống.</p>

        <button
          onClick={() => {
            localStorage.removeItem("token");
            onClose();
            window.dispatchEvent(new Event("openLogin"));
          }}
          className="btn-primary"
        >
          Đăng nhập lại
        </button>
      </div>
    </div>
  );
}