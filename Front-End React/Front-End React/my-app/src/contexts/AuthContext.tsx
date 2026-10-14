import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import api from "../api/axios";

const LS_KEYS = {
  accountId: "accountId",
  role: "role",
  name: "name",
  token: "token",
  userId: "userId",
  uid: "uid",
  email: "email",
  fullName: "fullName",
} as const;

const AUTH_KEYS = Object.values(LS_KEYS);
const ME_CHECK_INTERVAL_MS = 30_000;

type AuthUser = {
  accountId: string;
  role: string;
  name?: string;
};

type AuthContextType = {
  user: AuthUser | null;
  login: (user: AuthUser) => void;
  logout: (redirectTo?: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function clearAuthStorage() {
  // Không xóa alarms:* hay các cài đặt, dữ liệu thiết bị khác.
  for (const key of AUTH_KEYS) localStorage.removeItem(key);
}

function readCachedUser(): AuthUser | null {
  const accountId = localStorage.getItem(LS_KEYS.accountId);
  const role = localStorage.getItem(LS_KEYS.role);
  const name = localStorage.getItem(LS_KEYS.name);
  if (!accountId || !role) return null;
  return { accountId, role, name: name || undefined };
}

function parseMeResponse(data: any): AuthUser | null {
  if (data?.authenticated === false) return null;
  const raw = data?.user ?? data?.account ?? data?.data?.user ?? data;
  const accountId = String(raw?.id ?? raw?.Id ?? raw?.accountId ?? "").trim();
  const role = String(raw?.roleName ?? raw?.RoleName ?? raw?.role ?? "")
    .trim()
    .toLowerCase();
  const name = String(raw?.fullName ?? raw?.FullName ?? raw?.name ?? raw?.email ?? "").trim();
  return accountId && role ? { accountId, role, name } : null;
}

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  // Giữ UI cũ khi refresh; backend sẽ xác minh ngay sau khi mount.
  const [user, setUser] = useState<AuthUser | null>(() => readCachedUser());
  const mounted = useRef(true);
  const authRevision = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const redirectToLogin = useCallback(() => {
    if (window.location.pathname !== "/login") {
      window.location.replace("/login");
    }
  }, []);

  const invalidateAuth = useCallback((redirect = true) => {
    authRevision.current += 1;
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
    expiryTimer.current = null;
    clearAuthStorage();
    if (mounted.current) setUser(null);
    if (redirect) redirectToLogin();
  }, [redirectToLogin]);

  const scheduleExpiry = useCallback((expiresAt: unknown) => {
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
    expiryTimer.current = null;
    if (typeof expiresAt !== "string") return;

    const expiration = Date.parse(expiresAt);
    if (!Number.isFinite(expiration)) return;
    const remaining = expiration - Date.now();
    if (remaining <= 0) {
      invalidateAuth();
      return;
    }
    // Backend vẫn là nguồn xác thực thật. Timer chỉ giúp chuyển trang đúng hạn.
    expiryTimer.current = setTimeout(() => invalidateAuth(), remaining);
  }, [invalidateAuth]);

  const applyUser = useCallback((payload: AuthUser) => {
    localStorage.setItem(LS_KEYS.accountId, payload.accountId);
    localStorage.setItem(LS_KEYS.uid, payload.accountId);
    localStorage.setItem(LS_KEYS.role, payload.role);
    localStorage.setItem(LS_KEYS.name, payload.name || "");
    if (mounted.current) setUser(payload);
  }, []);

  const validateSession = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    const revision = authRevision.current;

    const task = (async () => {
      try {
        const response = await api.get("/api/auth/me", { withCredentials: true });
        if (!mounted.current || revision !== authRevision.current) return;
        const verified = parseMeResponse(response.data);
        if (!verified) {
          invalidateAuth(false);
          return;
        }
        applyUser(verified);
        // Nếu backend bổ sung expiresAtUtc, FE tự chuyển đúng hạn.
        scheduleExpiry(response.data?.expiresAtUtc);
      } catch (error: any) {
        if (!mounted.current || revision !== authRevision.current) return;
        const status = error?.response?.status;
        if (status === 401 || status === 403) {
          invalidateAuth(false);
        } else {
          // Lỗi mạng/500: không coi là hết phiên; lần kiểm tra sau sẽ thử lại.
          console.warn("[Auth] Không kiểm tra được phiên:", error);
        }
      }
    })();
    inFlight.current = task;
    void task.finally(() => {
      if (inFlight.current === task) inFlight.current = null;
    });
    return task;
  }, [applyUser, invalidateAuth, scheduleExpiry]);

  useEffect(() => {
    mounted.current = true;
    void validateSession();

    const onUnauthorized = () => invalidateAuth();
    const onFocus = () => void validateSession();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void validateSession();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === LS_KEYS.accountId && event.newValue === null) {
        invalidateAuth();
      }
    };

    window.addEventListener("auth:unauthorized", onUnauthorized);
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisibility);
    const checkInterval = window.setInterval(() => void validateSession(), ME_CHECK_INTERVAL_MS);

    return () => {
      mounted.current = false;
      authRevision.current += 1;
      window.clearInterval(checkInterval);
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
      window.removeEventListener("auth:unauthorized", onUnauthorized);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [invalidateAuth, validateSession]);

  const login = useCallback((payload: AuthUser) => {
    authRevision.current += 1;
    applyUser(payload);
    // Sau login, /me đồng bộ lại cookie và hạn phiên từ backend.
    void validateSession();
  }, [applyUser, validateSession]);

  const logout = useCallback(async (redirectTo?: string) => {
    const accountId = localStorage.getItem(LS_KEYS.accountId);
    // Đánh dấu trước khi gọi API để tránh request /me cũ ghi đè.
    authRevision.current += 1;
    try {
      await api.post("/api/auth/logout", accountId ? { accountId } : {});
    } catch (error) {
      console.warn("[Auth] Logout API lỗi:", error);
    } finally {
      invalidateAuth(false);
      if (redirectTo) window.location.replace(redirectTo);
    }
  }, [invalidateAuth]);

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
