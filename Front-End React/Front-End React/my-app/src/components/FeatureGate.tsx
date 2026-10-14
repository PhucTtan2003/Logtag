// src/components/FeatureGate.tsx
import React from "react";
import { useSubscriptionCtx } from "../contexts/SubscriptionProvider";

type Props = {
  need: string | string[];
  fallback?: React.ReactNode; // UI khi chưa có quyền
  children: React.ReactNode;
};

/**
 * Ẩn/hiện theo feature. Ví dụ:
 * <FeatureGate need="advanced_export"><AdvancedExportButton/></FeatureGate>
 */
export default function FeatureGate({ need, fallback = null, children }: Props) {
  const { hasFeature } = useSubscriptionCtx();
  const ok = Array.isArray(need) ? need.every(f => hasFeature(f)) : hasFeature(need);
  return <>{ok ? children : fallback}</>;
}
export {};