import React, { useCallback, useEffect, useState } from "react";
import api from "../api/axios";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import "../styles/Login.css";

interface LoginProps {
  isPopup?: boolean;
  onClose?: () => void;
}

type ParsedUser = {
  role: string;
  accountId: string;
  name: string;
  redirectTo?: string;
};

const normalizeText = (value: string) =>
  (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();

const isAlreadyLoggedInMessage = (message: string) => {
  const normalized = normalizeText(message);

  return (
    normalized.includes("da dang nhap") ||
    message.toLowerCase().includes("đã đăng nhập") ||
    message.toLowerCase().includes("already logged")
  );
};

const getDashboardPath = (role: string, redirectTo?: string) => {
  if (redirectTo?.startsWith("/")) {
    return redirectTo;
  }

  switch ((role || "").trim().toLowerCase()) {
    case "admin":
      return "/admin";

    case "employee":
      return "/employee";

    case "user":
      return "/user";

    default:
      return "/";
  }
};

const parseUserPayload = (data: any): ParsedUser => {
  const userRaw =
    data?.user ??
    data?.account ??
    data?.data?.user ??
    data?.data?.account ??
    data;

  const role = String(
    userRaw?.roleName ??
      userRaw?.role ??
      userRaw?.RoleName ??
      data?.roleName ??
      data?.role ??
      ""
  )
    .trim()
    .toLowerCase();

  const accountId = String(
    userRaw?.id ??
      userRaw?._id ??
      userRaw?.accountId ??
      userRaw?.userId ??
      userRaw?.Id ??
      data?.accountId ??
      data?.userId ??
      ""
  ).trim();

  const name = String(
    userRaw?.fullName ??
      userRaw?.FullName ??
      userRaw?.displayName ??
      userRaw?.name ??
      userRaw?.email ??
      data?.email ??
      ""
  ).trim();

  const redirectTo =
    data?.redirectTo ??
    userRaw?.redirectTo ??
    undefined;

  return {
    role,
    accountId,
    name,
    redirectTo,
  };
};

const Login: React.FC<LoginProps> = ({
  isPopup = false,
  onClose,
}) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  const { login } = useAuth();
  const navigate = useNavigate();

  const mode = isPopup ? "popup-mode" : "page-mode";

  /**
   * Quan trọng:
   * Phải lưu accountId/uid vì các API thiết bị hiện tại của hệ thống
   * vẫn đang đọc các key này để gắn AccountId/X-User-Id vào request.
   */
  const saveUserIdentity = useCallback((parsed: ParsedUser) => {
    localStorage.setItem("accountId", parsed.accountId);
    localStorage.setItem("uid", parsed.accountId);
    localStorage.setItem("role", parsed.role);
    localStorage.setItem("name", parsed.name || "");
  }, []);

  const finishLogin = useCallback(
    (data: any, headers?: any) => {
      const parsed = parseUserPayload(data);

      if (!parsed.role || !parsed.accountId) {
        console.error("[Login] Payload thiếu role hoặc accountId:", data);
        return false;
      }

      const token =
        data?.token ??
        data?.accessToken ??
        headers?.authorization ??
        "";

      if (token) {
        localStorage.setItem("token", String(token));
      }

      // Không được bỏ phần này, nếu không API device có thể trả danh sách rỗng.
      saveUserIdentity(parsed);

      login({
        role: parsed.role,
        accountId: parsed.accountId,
        name: parsed.name,
      });

      if (isPopup && onClose) {
        onClose();
      }

      navigate(getDashboardPath(parsed.role, parsed.redirectTo), {
        replace: true,
      });

      return true;
    },
    [
      isPopup,
      login,
      navigate,
      onClose,
      saveUserIdentity,
    ]
  );

  /**
   * Khôi phục phiên từ cookie.
   * Nếu chưa đăng nhập thì /me trả 401; đây là trạng thái bình thường.
   * Không được xóa accountId trong interceptor chỉ vì request kiểm tra này trả 401.
   */
  useEffect(() => {
    let cancelled = false;

    const checkAlreadyLoggedIn = async () => {
      try {
        const response = await api.get("/api/auth/me", {
          withCredentials: true,
        });

        if (cancelled) {
          return;
        }

        if (response.data?.authenticated === false) {
          return;
        }

        finishLogin(response.data, response.headers);
      } catch (requestError: any) {
        const status = requestError?.response?.status;

        if (status !== 401) {
          console.warn(
            "[Login] Không kiểm tra được phiên đăng nhập:",
            requestError
          );
        }
      } finally {
        if (!cancelled) {
          setCheckingSession(false);
        }
      }
    };

    checkAlreadyLoggedIn();

    return () => {
      cancelled = true;
    };
  }, [finishLogin]);

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    if (loading || checkingSession) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await api.post(
        "/api/auth/login",
        {
          email: email.trim(),
          password,
          rememberMe,
        },
        {
          withCredentials: true,
        }
      );

      if (finishLogin(response.data, response.headers)) {
        return;
      }

      setError(
        response.data?.message ||
          response.data?.title ||
          "Tài khoản hoặc phân quyền không hợp lệ."
      );
    } catch (requestError: any) {
      const message =
        requestError?.response?.data?.message ||
        requestError?.response?.data?.title ||
        requestError?.message ||
        "Đăng nhập thất bại.";

      if (isAlreadyLoggedInMessage(message)) {
        try {
          const meResponse = await api.get("/api/auth/me", {
            withCredentials: true,
          });

          if (
            finishLogin(
              meResponse.data,
              meResponse.headers
            )
          ) {
            return;
          }
        } catch {
          // Chỉ báo lỗi gốc khi /me cũng không khôi phục được phiên.
        }
      }

      // Không xóa accountId/uid tại đây.
      // Login thất bại không đồng nghĩa dữ liệu phân thiết bị phải bị mất.
      localStorage.removeItem("token");
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isPopup) {
      return;
    }

    const particles =
      document.querySelectorAll(".particle");

    particles.forEach((particle) => {
      const element = particle as HTMLElement;

      element.style.top = `${Math.random() * 100}%`;
      element.style.left = `${Math.random() * 100}%`;
      element.style.animationDuration =
        `${10 + Math.random() * 10}s`;
      element.style.animationDelay =
        `${Math.random() * 3}s`;
    });
  }, [isPopup]);

  const content = (
    <div className={`login-container ${mode}`}>
      {!isPopup && <div className="login-aurora" />}

      {!isPopup &&
        Array.from({ length: 12 }).map((_, index) => (
          <span key={index} className="particle" />
        ))}

      <div className="login-card">
        {isPopup && (
          <button
            className="login-close"
            onClick={onClose}
            type="button"
          >
            ✕
          </button>
        )}

        <div className="brand-head">
          <img
            src="/Pictures/logo.png"
            alt="SmartTech"
          />

          <div className="brand-title">
            <h1>SMARTTECH - VN</h1>
            <small>
              Smarter Solutions, Greater Impact
            </small>
          </div>
        </div>

        <p className="login-subtitle">
          {checkingSession
            ? "Đang kiểm tra phiên đăng nhập…"
            : "Đăng nhập để làm việc thông minh hơn ✨"}
        </p>

        {error && (
          <div className="login-error">{error}</div>
        )}

        <form
          onSubmit={handleSubmit}
          className="login-form"
        >
          <div className="input-group">
            <div className="icon">📧</div>

            <input
              type="email"
              placeholder="Email công việc"
              value={email}
              onChange={(event) =>
                setEmail(event.target.value)
              }
              required
              autoFocus
              autoComplete="username"
              disabled={loading || checkingSession}
            />
          </div>

          <div className="input-group">
            <div className="icon">🔒</div>

            <input
              type="password"
              placeholder="Mật khẩu"
              value={password}
              onChange={(event) =>
                setPassword(event.target.value)
              }
              required
              autoComplete="current-password"
              disabled={loading || checkingSession}
            />
          </div>

          <div className="login-helpers">
            <label>
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(event) =>
                  setRememberMe(event.target.checked)
                }
                disabled={loading || checkingSession}
              />{" "}
              Ghi nhớ đăng nhập
            </label>
          </div>

          <button
            type="submit"
            className="login-button"
            disabled={loading || checkingSession}
          >
            {checkingSession
              ? "Đang kiểm tra…"
              : loading
              ? "Đang đăng nhập…"
              : "Đăng nhập"}
          </button>
        </form>

        <div className="login-footer">
          © SMARTTECH {new Date().getFullYear()}
          <br />

          <a
            href="https://smarttechco.com.vn/"
            target="_blank"
            rel="noopener noreferrer"
          >
            🌐 Ghé thăm website
          </a>
        </div>
      </div>
    </div>
  );

  if (isPopup) {
    return (
      <div className="login-modal">
        <div
          className="login-overlay"
          onClick={onClose}
        />

        <div className="login-popup">
          {content}
        </div>
      </div>
    );
  }

  return content;
};

export default Login;