// src/components/UserPlanBanner.tsx
import React from "react";
import { useSubscriptionCtx } from "../contexts/SubscriptionProvider";

export default function UserPlanBanner() {
  const { me, loading } = useSubscriptionCtx();

  if (loading) return null;

  // ưu tiên isActive (API mới), fallback active (API cũ)
  const isActive = (me as any)?.isActive ?? (me as any)?.active ?? false;

  // Nếu không active -> hiển thị BASIC mặc định
  const planName = isActive ? (me?.plan ?? "basic").toUpperCase() : "BASIC";

  // daysLeft chỉ có ý nghĩa khi còn hạn
  const daysLeft =
    isActive && Number.isFinite(me?.daysLeft) ? (me!.daysLeft as number) : 0;

  const hasFeatures =
    isActive && Array.isArray(me?.features) && me!.features.length > 0;

  return (
    <div
      className="plan-banner"
      style={{
        background: "linear-gradient(90deg,#4f46e5,#22d3ee)",
        color: "#fff",
        padding: 12,
        borderRadius: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        boxShadow: "0 8px 24px rgba(0,0,0,.15)",
      }}
    >
      <div>
        <div style={{ fontSize: 14, opacity: 0.9 }}>Current plan</div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{planName}</div>
          <span
            style={{
              padding: "2px 8px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 700,
              background: isActive ? "rgba(16,185,129,.15)" : "rgba(239,68,68,.15)",
              color: isActive ? "#10b981" : "#ef4444",
              border: `1px solid ${isActive ? "#10b98155" : "#ef444455"}`,
            }}
            aria-label={isActive ? "Active" : "Expired"}
          >
            {isActive ? "Active" : "Expired"}
          </span>
        </div>

        <div style={{ marginTop: 6, fontSize: 13, opacity: 0.95 }}>
          {hasFeatures
            ? <>Features: {me!.features!.join(", ")}</>
            : <>Không có tính năng nâng cao</>}
        </div>
      </div>

      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 13 }}>Days left</div>
        <div style={{ fontSize: 22, fontWeight: 800 }}>{daysLeft}</div>
      </div>
    </div>
  );
}