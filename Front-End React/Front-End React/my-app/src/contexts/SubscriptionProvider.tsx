
// src/contexts/SubscriptionProvider.tsx
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router-dom";
import { getMe, type MeResp } from "../api/subscriptions";

type Ctx = {
  me: MeResp | null;
  loading: boolean;
  /** Gọi lại /api/subscriptions/me để lấy trạng thái mới nhất */
  refresh: () => Promise<void>;
  /** Kiểm tra feature có tồn tại (không phân biệt hoa thường) */
  hasFeature: (f: string) => boolean;
};

const SubscriptionContext = createContext<Ctx | undefined>(undefined);

export const SubscriptionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { pathname } = useLocation();
  const [me, setMe] = useState<MeResp | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const retryTimer = useRef<number | null>(null);

  /** Không còn skip theo pathname; chỉ bỏ qua nếu chưa có userId/accountId */
  const fetchMe = useCallback(async () => {
    const uid = localStorage.getItem("userId") || localStorage.getItem("accountId");
    if (!uid) {
      // Không gán về BASIC để tránh “flash basic”
      setMe(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const m = await getMe(); // GET /api/subscriptions/me
      setMe(m);
    } catch (err) {
      // Không ép về BASIC ở đây để UI không nháy sai; để null cho các component tự xử lý
      console.warn("getMe failed:", err);
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    await fetchMe();
  }, [fetchMe]);

  /** Nạp lần đầu + mỗi khi route đổi (SPA điều hướng xong sẽ tự cập nhật) */
  useEffect(() => {
    void fetchMe();

    // Retry ngắn nếu userId được set trễ (đăng nhập/restore session)
    if (retryTimer.current) window.clearTimeout(retryTimer.current);
    retryTimer.current = window.setTimeout(() => {
      const uid = localStorage.getItem("userId") || localStorage.getItem("accountId");
      if (!me && uid) void fetchMe();
    }, 400);

    return () => {
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  /** Tự refresh khi quay lại tab (vừa redeem code hay nâng cấp xong) */
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  /** Tự refresh khi userId/accountId thay đổi (ở tab/luồng khác) */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "userId" || e.key === "accountId") void refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refresh]);

  const hasFeature = useCallback(
    (f: string) => !!me?.features?.some((x) => x?.toLowerCase?.() === f.toLowerCase()),
    [me]
  );

  const value = useMemo<Ctx>(
    () => ({ me, loading, refresh, hasFeature }),
    [me, loading, refresh, hasFeature]
  );

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
};

export function useSubscriptionCtx(): Ctx {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error("useSubscriptionCtx must be used within SubscriptionProvider");
  return ctx;
}

export {};