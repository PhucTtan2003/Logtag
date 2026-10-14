// src/pages/user/SmsActivationSection.tsx
import React, { useCallback, useState } from "react";
import api from "../../api/axios";

export default function SmsActivationSection() {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);

  const normalizePhone = (raw: string) => raw.trim();

  const doActivate = useCallback(async () => {
    const trimmed = normalizePhone(phone);
    if (!trimmed) {
      setOk(false);
      setMsg("Vui lòng nhập số điện thoại.");
      return;
    }

    setBusy(true);
    setMsg(null);

    try {
      const resp = await api.post("/api/sms/activate", {
        phone: trimmed,
      });

      setOk(true);
      setMsg(resp?.data?.message || "Đã kích hoạt SMS cảnh báo thành công.");
    } catch (err: any) {
      console.error("activate sms failed", err);
      const apiMsg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        "Không kích hoạt được SMS. Vui lòng thử lại.";
      setOk(false);
      setMsg(apiMsg);
    } finally {
      setBusy(false);
    }
  }, [phone]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !busy) {
      e.preventDefault();
      void doActivate();
    }
  };

  return (
    <section
      className="sms-activation-section"
      style={{
        marginTop: 24,
        padding: 16,
        borderRadius: 16,
        border: "1px solid #e5e7eb",
        background: "#f9fafb",
      }}
    >
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Dịch vụ SMS cảnh báo</h2>
      <p style={{ marginTop: 8, marginBottom: 16, color: "#6b7280", fontSize: 14 }}>
        Nhập số điện thoại để nhận tin nhắn SMS khi có cảnh báo nhiệt độ/độ ẩm.
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Nhập số điện thoại (vd: 0901234567 hoặc +84901234567)"
          autoComplete="tel"
          disabled={busy}
          style={{
            flex: 1,
            padding: 10,
            borderRadius: 10,
            border: "1px solid #e5e7eb",
            outline: "none",
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void doActivate()}
          style={{
            padding: "10px 16px",
            borderRadius: 999,
            border: "none",
            background: busy ? "#9ca3af" : "linear-gradient(135deg,#6366f1,#8b5cf6)",
            color: "white",
            fontWeight: 600,
            cursor: busy ? "default" : "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {busy ? "Đang lưu..." : "Kích hoạt SMS"}
        </button>
      </div>

      {msg && (
        <div
          style={{
            marginTop: 8,
            color: ok ? "#16a34a" : "#dc2626",
            fontWeight: 500,
            whiteSpace: "pre-wrap",
          }}
        >
          {msg}
        </div>
      )}

      <p style={{ marginTop: 8, marginBottom: 0, fontSize: 12, color: "#9ca3af" }}>
        * Số điện thoại sẽ được dùng để gửi tin nhắn cảnh báo cho tài khoản của bạn.
      </p>
    </section>
  );
}
