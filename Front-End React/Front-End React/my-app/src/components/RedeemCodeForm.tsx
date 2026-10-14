// src/components/RedeemCodeForm.tsx
import React, { useCallback, useState } from "react";
import { redeemCode } from "../api/subscriptions";
import { useSubscriptionCtx } from "../contexts/SubscriptionProvider";

export default function RedeemCodeForm() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const { refresh } = useSubscriptionCtx();

  const getUserId = () =>
    localStorage.getItem("userId") ||
    localStorage.getItem("accountId") ||
    localStorage.getItem("AccountId") ||
    undefined;

  const doRedeem = useCallback(async () => {
    const trimmed = code.trim();
    if (!trimmed) {
      setOk(false);
      setMsg("Vui lòng nhập mã.");
      return;
    }

    setBusy(true);
    setMsg(null);
    setOk(null);

    try {
      const userId = getUserId();
      const res = await redeemCode(trimmed, userId);

      // Debug để chắc chắn BE trả về features gì
      console.log("Redeem result:", res);

      const hasSms =
        Array.isArray(res.features) &&
        res.features.some((f) => f?.toLowerCase() === "sms_alert");

      setOk(true);
      setMsg(
        hasSms
          ? "Đã kích hoạt dịch vụ SMS cảnh báo. Bạn có thể vào mục 'SMS cảnh báo' để thiết lập số điện thoại."
          : `Nâng cấp thành công lên gói ${res.plan.toUpperCase()}.`
      );

      setCode("");
      await refresh(); // ✅ lấy lại /api/subscriptions/me để FeatureGate cập nhật
    } catch (e: any) {
      setOk(false);
      const m = e?.response?.data?.message || "Đổi mã thất bại.";
      setMsg(m);
      // Log chi tiết để debug nhanh trong DevTools
      // eslint-disable-next-line no-console
      console.warn("redeem failed:", e?.response?.data || e?.message);
    } finally {
      setBusy(false);
    }
  }, [code, refresh]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !busy) {
      e.preventDefault();
      void doRedeem();
    }
  };

  return (
    <div
      className="redeem-form"
      style={{ marginTop: 16, display: "flex", gap: 8, alignItems: "center" }}
    >
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Nhập mã kích hoạt (ví dụ ABCD-1234-Z9XY)"
        autoComplete="one-time-code"
        style={{
          flex: 1,
          padding: 10,
          borderRadius: 10,
          border: "1px solid #e5e7eb",
          outline: "none",
        }}
      />
      <button
        onClick={() => void doRedeem()}
        disabled={busy || !code.trim()}
        style={{
          padding: "10px 16px",
          borderRadius: 10,
          border: "none",
          background: busy || !code.trim() ? "#a5b4fc" : "#6366f1",
          color: "#fff",
          fontWeight: 700,
          cursor: busy || !code.trim() ? "not-allowed" : "pointer",
          minWidth: 96,
        }}
      >
        {busy ? "Đang xử lý..." : "Đổi mã"}
      </button>

      {msg && (
        <div
          style={{
            marginLeft: 8,
            color: ok ? "#16a34a" : "#dc2626",
            fontWeight: 500,
            whiteSpace: "pre-wrap",
          }}
        >
          {msg}
        </div>
      )}
    </div>
  );
}
