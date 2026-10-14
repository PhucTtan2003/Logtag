import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  BellRing,
  MessageSquareText,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import api from "../api/axios";
import "../styles/SmsQuotaNotice.css";


type SmsQuotaResponse = {
  status?: string;
  userId?: string;
  plan?: string;
  features?: string[];
  hasSubscription?: boolean;
  smsEnabled?: boolean;
  isActive?: boolean;
  daysLeft?: number;
  endsAtUtc?: string | null;

  smsQuotaTotal?: number | null;
  smsQuotaUsed?: number | null;
  smsRemaining?: number | null;
  smsUnlimited?: boolean | null;
  smsWarnAtRemaining?: number | null;
  isLow?: boolean | null;

  shouldRenew?: boolean | null;
  renewMessage?: string | null;
  message?: string;
  reason?: string | null;
};

type Props = {
  /** Mặc định cảnh báo khi còn dưới 50 tin */
  warnBelow?: number;
  /** Tự refresh sau bao nhiêu giây. 0 = không tự refresh */
  autoRefreshSeconds?: number;
  className?: string;
};

function fmtNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("vi-VN").format(value);
}

function fmtDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("vi-VN");
}

export default function SmsQuotaNotice({
  warnBelow = 50,
  autoRefreshSeconds = 60,
  className = "",
}: Props) {
  const [data, setData] = useState<SmsQuotaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  const loadQuota = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError("");

      // Dùng axios instance chung để tự có baseURL, cookie auth, accountId, X-User-Id.
      // Local: https://localhost:44300/api/sms/quota/me
      // Domain thật: /api/sms/quota/me
      const res = await api.get<SmsQuotaResponse>("/api/sms/quota/me", {
        headers: { Accept: "application/json" },
      });

      setData(res.data ?? null);
    } catch (err: any) {
      const status = err?.response?.status;
      const serverMessage = err?.response?.data?.message;

      if (status === 401 || status === 403) {
        setData(null);
        setError("Bạn cần đăng nhập để xem số SMS còn lại.");
        return;
      }

      if (status === 404) {
        setData(null);
        setError("Backend chưa có API /api/sms/quota/me hoặc chưa restart server.");
        return;
      }

      setData(null);
      setError(serverMessage || "Không kết nối được máy chủ để lấy số SMS còn lại.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQuota();
  }, [loadQuota]);

  useEffect(() => {
    if (!autoRefreshSeconds || autoRefreshSeconds <= 0) return;

    const timer = window.setInterval(() => {
      loadQuota(true);
    }, autoRefreshSeconds * 1000);

    return () => window.clearInterval(timer);
  }, [autoRefreshSeconds, loadQuota]);

  const vm = useMemo(() => {
    const hasSubscription = data?.hasSubscription !== false;
    const active = data?.isActive !== false;
    const smsEnabled = data?.smsEnabled !== false;

    const unlimited = data?.smsUnlimited === true;
    const total = data?.smsQuotaTotal ?? null;
    const used = Math.max(0, data?.smsQuotaUsed ?? 0);
    const remaining = unlimited ? null : data?.smsRemaining ?? null;

    const notConfigured = !unlimited && (total === null || total === undefined);

    const lowByBackend = data?.shouldRenew === true || data?.isLow === true;
    const lowByClient =
      !unlimited &&
      !notConfigured &&
      typeof remaining === "number" &&
      remaining < warnBelow;

    const empty =
      !unlimited &&
      !notConfigured &&
      typeof remaining === "number" &&
      remaining <= 0;

    const low = lowByBackend || lowByClient || empty;

    let percent = 0;
    if (!unlimited && !notConfigured && typeof total === "number" && total > 0) {
      percent = Math.min(100, Math.max(0, (used / total) * 100));
    }

    const renewMessage =
      data?.renewMessage?.trim() ||
      "Bạn vui lòng gia hạn để tiếp tục sử dụng dịch vụ.";

    return {
      hasSubscription,
      active,
      smsEnabled,
      unlimited,
      total,
      used,
      remaining,
      notConfigured,
      low,
      empty,
      percent,
      renewMessage,
    };
  }, [data, warnBelow]);

  if (loading) {
    return (
      <section className={`sms-quota-notice is-loading ${className}`}>
        <div className="sms-quota-icon">
          <RefreshCw size={20} />
        </div>
        <div>
          <strong>Đang tải SMS...</strong>
          <p>Đang kiểm tra số tin nhắn còn lại.</p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className={`sms-quota-notice is-error ${className}`}>
        <div className="sms-quota-icon">
          <TriangleAlert size={20} />
        </div>
        <div className="sms-quota-main">
          <strong>Không lấy được số SMS</strong>
          <p>{error}</p>
        </div>
        <button type="button" onClick={() => loadQuota()} className="sms-quota-refresh">
          Thử lại
        </button>
      </section>
    );
  }

  if (!data) return null;

  if (!vm.hasSubscription || !vm.active) {
    return (
      <section className={`sms-quota-notice is-warning ${className}`}>
        <div className="sms-quota-icon">
          <TriangleAlert size={20} />
        </div>
        <div className="sms-quota-main">
          <strong>Gói SMS chưa hoạt động</strong>
          <p>Bạn vui lòng gia hạn để tiếp tục sử dụng dịch vụ.</p>
        </div>
        <button type="button" onClick={() => loadQuota(true)} className="sms-quota-refresh" title="Làm mới">
          <RefreshCw size={16} />
        </button>
      </section>
    );
  }

  if (!vm.smsEnabled) {
    return (
      <section className={`sms-quota-notice is-warning ${className}`}>
        <div className="sms-quota-icon">
          <TriangleAlert size={20} />
        </div>
        <div className="sms-quota-main">
          <strong>SMS cảnh báo chưa được kích hoạt</strong>
          <p>Vui lòng liên hệ quản trị viên để mở tính năng SMS cảnh báo.</p>
        </div>
      </section>
    );
  }

  if (vm.unlimited) {
    return (
      <section className={`sms-quota-notice is-ok ${className}`}>
        <div className="sms-quota-icon">
          <MessageSquareText size={20} />
        </div>
        <div className="sms-quota-main">
          <strong>SMS không giới hạn</strong>
          <p>Gói của bạn đang hoạt động đến {fmtDate(data.endsAtUtc)}.</p>
        </div>
        <button type="button" onClick={() => loadQuota(true)} className="sms-quota-refresh" title="Làm mới">
          <RefreshCw size={16} />
        </button>
      </section>
    );
  }

  if (vm.notConfigured) {
    return (
      <section className={`sms-quota-notice is-warning ${className}`}>
        <div className="sms-quota-icon">
          <TriangleAlert size={20} />
        </div>
        <div className="sms-quota-main">
          <strong>SMS chưa được cấu hình số lượng tin</strong>
          <p>Vui lòng liên hệ quản trị viên để cập nhật gói SMS cho tài khoản.</p>
        </div>
      </section>
    );
  }

  return (
    <section className={`sms-quota-notice ${vm.low ? "is-danger" : "is-ok"} ${className}`}>
      <div className="sms-quota-icon">
        {vm.low ? <BellRing size={20} /> : <MessageSquareText size={20} />}
      </div>

      <div className="sms-quota-main">
        <div className="sms-quota-head">
          <strong>Còn {fmtNumber(vm.remaining)} SMS</strong>
          <span>
            Đã dùng {fmtNumber(vm.used)} / {fmtNumber(vm.total)}
          </span>
        </div>

        <div className="sms-quota-bar" aria-label="SMS usage progress">
          <i style={{ width: `${vm.percent}%` }} />
        </div>

        {vm.low ? (
          <p className="sms-quota-alert">{vm.renewMessage}</p>
        ) : (
          <p>SMS cảnh báo vẫn đang hoạt động bình thường.</p>
        )}
      </div>

      <button type="button" onClick={() => loadQuota(true)} className="sms-quota-refresh" title="Làm mới">
        <RefreshCw size={16} />
      </button>
    </section>
  );
}
