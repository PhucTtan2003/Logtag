// src/pages/Admin/AdminSmsServiceManagerPage.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "../../api/axios";
import "../../styles/Admin/AdminSmsServiceManagerPage.css";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardCopy,
  Coins,
  Copy,
  Infinity as InfinityIcon,
  KeyRound,
  Loader2,
  MessageSquareText,
  Phone,
  PlusCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  UsersRound,
  XCircle,
} from "lucide-react";

type TabKey = "quota" | "codes" | "phones";
type ToastKind = "success" | "error" | "info";

type ToastState = {
  kind: ToastKind;
  message: string;
} | null;

type LicenseCodeItem = {
  code: string;
  plan?: string;
  features?: string[];
  durationDays?: number;
  maxActivations?: number;
  used?: number;
  remaining?: number;
  hasSlots?: boolean;
  notes?: string | null;
  createdAtUtc?: string | null;

  smsQuotaTotal?: number | null;
  smsUnlimited?: boolean;
  smsWarnAtRemaining?: number | null;
};

type AdminSubItem = {
  userId: string;
  userName?: string | null;
  email?: string | null;
  plan?: string;
  features?: string[];
  startedAtUtc?: string;
  endsAtUtc?: string;
  isActive?: boolean;
  daysLeft?: number;

  smsQuotaTotal?: number | null;
  smsQuotaUsed?: number | null;
  smsRemaining?: number | null;
  smsUnlimited?: boolean;
  smsLowQuotaWarned?: boolean;
  smsLowQuotaWarnedAtUtc?: string | null;
};

type SmsActivationItem = {
  id: string;
  userId: string;
  email?: string | null;
  name?: string | null;
  phone?: string | null;
  activatedAtUtc?: string | null;
  licenseCode?: string | null;
  notes?: string | null;
};

type AccountItem = {
  id: string;
  email?: string | null;
  name?: string | null;
};

type IssuePayload = {
  code?: string;
  plan: string;
  features?: string[];
  durationDays: number;
  maxActivations: number;
  notes?: string;
  reservedForUserId?: string;

  smsQuotaTotal?: number | null;
  smsUnlimited?: boolean;
  smsWarnAtRemaining?: number | null;
};

type IssueForm = {
  code: string;
  plan: string;
  durationDays: number;
  maxActivations: number;
  notes: string;
  reservedForUserId: string;
  smsQuotaTotal: string;
  smsUnlimited: boolean;
  smsWarnAtRemaining: string;
};

const PLAN_OPTIONS = [
  {
    value: "sms_1000_year",
    label: "SMS 1.000 tin / 1 năm",
    subtitle: "Phù hợp khách dùng ít",
    quota: 1000,
    durationDays: 365,
    unlimited: false,
    warnAt: 100,
    features: ["sms_alert"],
  },
  {
    value: "sms_10000_year",
    label: "SMS 10.000 tin / 1 năm",
    subtitle: "Phù hợp khách nhiều thiết bị",
    quota: 10000,
    durationDays: 365,
    unlimited: false,
    warnAt: 500,
    features: ["sms_alert"],
  },
  {
    value: "sms_unlimited_year",
    label: "SMS không giới hạn / 1 năm",
    subtitle: "Không trừ quota tin nhắn",
    quota: null,
    durationDays: 365,
    unlimited: true,
    warnAt: null,
    features: ["sms_alert"],
  },
  {
    value: "sms_custom",
    label: "SMS custom",
    subtitle: "Admin tự nhập số tin",
    quota: 5000,
    durationDays: 365,
    unlimited: false,
    warnAt: 300,
    features: ["sms_alert"],
  },
  {
    value: "premium",
    label: "Premium full quyền",
    subtitle: "Thiết bị nâng cao + SMS",
    quota: null,
    durationDays: 365,
    unlimited: true,
    warnAt: null,
    features: [
      "advanced_devices",
      "alert_history_90d",
      "priority_alerts",
      "advanced_export",
      "sms_alert",
      "sms_schedule",
    ],
  },
] as const;

const FEATURE_LABEL: Record<string, string> = {
  sms_alert: "SMS cảnh báo",
  sms_schedule: "SMS định kỳ",
  advanced_devices: "Thiết bị nâng cao",
  alert_history_90d: "Lịch sử 90 ngày",
  priority_alerts: "Cảnh báo ưu tiên",
  advanced_export: "Xuất nâng cao",
};

const strip = (value?: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const fmtNumber = (n?: number | null) => {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  return Number(n).toLocaleString("vi-VN");
};

const fmtDateTime = (iso?: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("vi-VN", {
    hour12: false,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const getPlanMeta = (plan?: string) => {
  const p = strip(plan).replace(/-/g, "_");
  if (p.includes("10000")) return { label: "SMS 10.000", tone: "sms10000" };
  if (p.includes("1000")) return { label: "SMS 1.000", tone: "sms1000" };
  if (p.includes("unlimited")) return { label: "Unlimited", tone: "unlimited" };
  if (p.includes("custom")) return { label: "Custom", tone: "custom" };
  if (p.includes("premium")) return { label: "Premium", tone: "premium" };
  if (p.includes("sms")) return { label: "SMS", tone: "sms" };
  if (p.includes("pro")) return { label: "Pro", tone: "pro" };
  return { label: plan || "Basic", tone: "basic" };
};

const getDisplayUser = (x: AdminSubItem) =>
  x.userName?.trim() || x.email?.trim() || x.userId || "Không rõ user";

const initials = (name?: string | null, email?: string | null) => {
  const src = (name || email || "U").trim();
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : src.slice(0, 2)).toUpperCase();
};

const safeUsed = (x: AdminSubItem) => Math.max(0, Number(x.smsQuotaUsed ?? 0) || 0);

const safeTotal = (x: AdminSubItem) => {
  const total = Number(x.smsQuotaTotal);
  return Number.isFinite(total) && total > 0 ? total : 0;
};

const safeRemaining = (x: AdminSubItem) => {
  if (x.smsUnlimited) return Number.POSITIVE_INFINITY;
  if (x.smsRemaining !== null && x.smsRemaining !== undefined) {
    const rem = Number(x.smsRemaining);
    return Number.isFinite(rem) ? Math.max(0, rem) : 0;
  }
  return Math.max(0, safeTotal(x) - safeUsed(x));
};

const quotaPercent = (x: AdminSubItem) => {
  if (x.smsUnlimited) return 100;
  const total = safeTotal(x);
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((safeUsed(x) / total) * 100)));
};

const isLowQuota = (x: AdminSubItem) => {
  if (x.smsUnlimited) return false;
  const total = safeTotal(x);
  const remaining = safeRemaining(x);
  if (total <= 0) return false;
  return Boolean(x.smsLowQuotaWarned) || remaining <= Math.max(100, Math.round(total * 0.1));
};

const hasSmsFeature = (features?: string[]) =>
  Array.isArray(features) && features.some((f) => strip(f) === "sms_alert" || strip(f) === "sms_schedule");

function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(onClose, 2600);
    return () => window.clearTimeout(timer);
  }, [toast, onClose]);

  if (!toast) return null;

  return (
    <div className={`smsx-toast smsx-toast--${toast.kind}`}>
      <b>{toast.kind === "success" ? "Thành công" : toast.kind === "error" ? "Cần kiểm tra" : "Thông báo"}</b>
      <span>{toast.message}</span>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: string;
}) {
  return (
    <article className={`smsx-stat ${tone ? `smsx-stat--${tone}` : ""}`}>
      <span className="smsx-stat__icon">{icon}</span>
      <div>
        <p>{label}</p>
        <h3>{value}</h3>
        {hint && <small>{hint}</small>}
      </div>
    </article>
  );
}

function FeatureChips({ features }: { features?: string[] }) {
  const list = Array.isArray(features) ? features.filter(Boolean) : [];
  if (list.length === 0) return <span className="smsx-muted">Không có feature</span>;

  return (
    <div className="smsx-features">
      {list.map((f) => (
        <span key={f}>{FEATURE_LABEL[f] || f}</span>
      ))}
    </div>
  );
}

function QuotaBar({ item }: { item: AdminSubItem }) {
  if (item.smsUnlimited) {
    return (
      <div className="smsx-quota">
        <div className="smsx-quota__line">
          <span>Không giới hạn</span>
          <b>Unlimited</b>
        </div>
        <div className="smsx-progress smsx-progress--unlimited">
          <i style={{ width: "100%" }} />
        </div>
      </div>
    );
  }

  const percent = quotaPercent(item);
  const low = isLowQuota(item);

  return (
    <div className="smsx-quota">
      <div className="smsx-quota__line">
        <span>
          Đã dùng {fmtNumber(safeUsed(item))}/{fmtNumber(safeTotal(item))}
        </span>
        <b className={low ? "is-danger" : ""}>Còn {fmtNumber(safeRemaining(item))}</b>
      </div>
      <div className={`smsx-progress ${low ? "is-danger" : percent >= 70 ? "is-warn" : ""}`}>
        <i style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export default function AdminSmsServiceManagerPage() {
  const [tab, setTab] = useState<TabKey>("quota");
  const [codes, setCodes] = useState<LicenseCodeItem[]>([]);
  const [subs, setSubs] = useState<AdminSubItem[]>([]);
  const [phones, setPhones] = useState<SmsActivationItem[]>([]);
  const [accounts, setAccounts] = useState<AccountItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [savingCode, setSavingCode] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "active" | "expired" | "low" | "sms">("");
  const [onlyUnusedCodes, setOnlyUnusedCodes] = useState(false);

  const [form, setForm] = useState<IssueForm>(() => ({
    code: "",
    plan: "sms_1000_year",
    durationDays: 365,
    maxActivations: 1,
    notes: "Gói 1000 tin SMS / 1 năm",
    reservedForUserId: "",
    smsQuotaTotal: "1000",
    smsUnlimited: false,
    smsWarnAtRemaining: "100",
  }));

  const selectedPlan = useMemo(
    () => PLAN_OPTIONS.find((p) => p.value === form.plan),
    [form.plan]
  );

  const applyPlan = (plan: string) => {
    const meta = PLAN_OPTIONS.find((p) => p.value === plan);
    setForm((old) => ({
      ...old,
      plan,
      durationDays: meta?.durationDays ?? old.durationDays,
      smsQuotaTotal: meta?.quota === null ? "" : String(meta?.quota ?? old.smsQuotaTotal),
      smsUnlimited: Boolean(meta?.unlimited),
      smsWarnAtRemaining: meta?.warnAt === null ? "" : String(meta?.warnAt ?? old.smsWarnAtRemaining),
      notes:
        plan === "sms_1000_year"
          ? "Gói 1000 tin SMS / 1 năm"
          : plan === "sms_10000_year"
          ? "Gói 10000 tin SMS / 1 năm"
          : plan === "sms_unlimited_year"
          ? "Gói SMS không giới hạn / 1 năm"
          : old.notes,
    }));
  };

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [codeRes, subRes, phoneRes, accRes] = await Promise.all([
        api.get("/api/admin/license-codes", {
          params: { onlyUnused: onlyUnusedCodes, skip: 0, take: 200 },
        }),
        api.get("/api/admin/subscriptions", {
          params: { skip: 0, take: 500 },
        }),
        api.get("/api/admin/sms-activations", {
          params: { skip: 0, take: 500 },
        }),
        api.get("/api/admin/accounts-users", {
          params: { onlyActive: true, skip: 0, take: 500 },
        }),
      ]);

      setCodes(Array.isArray(codeRes.data?.items) ? codeRes.data.items : []);
      setSubs(Array.isArray(subRes.data?.items) ? subRes.data.items : []);
      setPhones(Array.isArray(phoneRes.data?.items) ? phoneRes.data.items : []);
      setAccounts(Array.isArray(accRes.data?.items) ? accRes.data.items : []);
    } catch (e: any) {
      console.error(e);
      setError(e?.response?.data?.message || e?.message || "Không tải được dữ liệu quản lý SMS.");
      setCodes([]);
      setSubs([]);
      setPhones([]);
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, [onlyUnusedCodes]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const stats = useMemo(() => {
    const smsSubs = subs.filter((x) => hasSmsFeature(x.features) || x.smsQuotaTotal || x.smsUnlimited);
    const active = smsSubs.filter((x) => x.isActive).length;
    const unlimited = smsSubs.filter((x) => x.smsUnlimited).length;
    const low = smsSubs.filter(isLowQuota).length;

    const totalQuota = smsSubs
      .filter((x) => !x.smsUnlimited)
      .reduce((sum, x) => sum + safeTotal(x), 0);

    const usedQuota = smsSubs
      .filter((x) => !x.smsUnlimited)
      .reduce((sum, x) => sum + safeUsed(x), 0);

    const remainingQuota = Math.max(0, totalQuota - usedQuota);

    return {
      smsAccounts: smsSubs.length,
      active,
      unlimited,
      low,
      totalQuota,
      usedQuota,
      remainingQuota,
      codesReady: codes.filter((x) => (x.hasSlots ?? Number(x.remaining ?? 0) > 0)).length,
      phones: phones.length,
    };
  }, [codes, phones.length, subs]);

  const filteredSubs = useMemo(() => {
    const q = strip(query);

    return subs
      .filter((x) => {
        if (statusFilter === "active") return Boolean(x.isActive);
        if (statusFilter === "expired") return !x.isActive;
        if (statusFilter === "low") return isLowQuota(x);
        if (statusFilter === "sms") return hasSmsFeature(x.features) || Boolean(x.smsQuotaTotal || x.smsUnlimited);
        return true;
      })
      .filter((x) => {
        if (!q) return true;
        const text = [
          x.userId,
          x.userName,
          x.email,
          x.plan,
          x.features?.join(" "),
          x.smsUnlimited ? "unlimited khong gioi han" : "",
          isLowQuota(x) ? "sap het tin low quota" : "",
        ]
          .map(strip)
          .join(" ");
        return text.includes(q);
      })
      .sort((a, b) => {
        const lowDiff = Number(isLowQuota(b)) - Number(isLowQuota(a));
        if (lowDiff !== 0) return lowDiff;
        return safeRemaining(a) - safeRemaining(b);
      });
  }, [query, statusFilter, subs]);

  const filteredCodes = useMemo(() => {
    const q = strip(query);
    return codes.filter((x) => {
      if (!q) return true;
      return [
        x.code,
        x.plan,
        x.notes,
        x.features?.join(" "),
        x.smsUnlimited ? "unlimited khong gioi han" : "",
        x.smsQuotaTotal,
      ]
        .map(strip)
        .join(" ")
        .includes(q);
    });
  }, [codes, query]);

  const filteredPhones = useMemo(() => {
    const q = strip(query);
    return phones.filter((x) => {
      if (!q) return true;
      return [x.email, x.name, x.phone, x.licenseCode, x.userId, x.notes]
        .map(strip)
        .join(" ")
        .includes(q);
    });
  }, [phones, query]);

  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setToast({ kind: "success", message: "Đã copy vào clipboard." });
    } catch {
      setToast({ kind: "error", message: "Không copy được, hãy copy thủ công." });
    }
  };

  const handleCreateCode = async (e: React.FormEvent) => {
    e.preventDefault();

    const total = Number(form.smsQuotaTotal);
    const warn = Number(form.smsWarnAtRemaining);

    if (!form.smsUnlimited && (!Number.isFinite(total) || total <= 0)) {
      setToast({ kind: "error", message: "Vui lòng nhập tổng số tin SMS hợp lệ." });
      return;
    }

    const payload: IssuePayload = {
      code: form.code.trim() || undefined,
      plan: form.plan,
      features: selectedPlan?.features ? [...selectedPlan.features] : ["sms_alert"],
      durationDays: Math.max(1, Number(form.durationDays) || 365),
      maxActivations: Math.max(1, Number(form.maxActivations) || 1),
      notes: form.notes.trim() || undefined,
      reservedForUserId: form.reservedForUserId || undefined,
      smsUnlimited: form.smsUnlimited,
      smsQuotaTotal: form.smsUnlimited ? null : total,
      smsWarnAtRemaining: form.smsUnlimited
        ? null
        : Number.isFinite(warn) && warn > 0
        ? warn
        : Math.max(1, Math.round(total * 0.1)),
    };

    setSavingCode(true);

    try {
      const res = await api.post("/api/admin/license-codes/issue", payload);
      const newCode = res.data?.code || payload.code || "code mới";

      setToast({ kind: "success", message: `Đã tạo code ${newCode}.` });
      setForm((old) => ({ ...old, code: "" }));
      await reload();
    } catch (err: any) {
      console.error(err);
      setToast({
        kind: "error",
        message: err?.response?.data?.message || err?.message || "Tạo code thất bại.",
      });
    } finally {
      setSavingCode(false);
    }
  };

  const handleDeleteCode = async (code: string) => {
    const ok = window.confirm(`Xoá code ${code}? Nếu code đã được dùng, backend có thể revoke quyền liên quan.`);
    if (!ok) return;

    try {
      await api.delete(`/api/admin/license-codes/${encodeURIComponent(code)}`);
      setToast({ kind: "success", message: `Đã xoá code ${code}.` });
      await reload();
    } catch (e: any) {
      console.error(e);
      setToast({
        kind: "error",
        message: e?.response?.data?.message || e?.message || "Xoá code thất bại.",
      });
    }
  };

  return (
    <div className="smsx-page">
      <header className="smsx-hero">
        <div>
          <span className="smsx-eyebrow">
            <MessageSquareText size={16} /> SMS service center
          </span>
          <h1>Quản lý tin SMS & code dịch vụ</h1>
          <p>
            Tạo code gói SMS, theo dõi quota từng account, kiểm tra số điện thoại nhận cảnh báo
            và phát hiện khách sắp hết tin.
          </p>
        </div>

        <button className="smsx-refresh" type="button" onClick={() => void reload()} disabled={loading}>
          {loading ? <Loader2 className="smsx-spin" size={18} /> : <RefreshCw size={18} />}
          Làm mới
        </button>
      </header>

      <section className="smsx-stats">
        <StatCard
          icon={<UsersRound size={22} />}
          label="Account SMS"
          value={fmtNumber(stats.smsAccounts)}
          hint={`${fmtNumber(stats.active)} đang hoạt động`}
          tone="blue"
        />
        <StatCard
          icon={<Coins size={22} />}
          label="Tin còn lại"
          value={fmtNumber(stats.remainingQuota)}
          hint={`Đã dùng ${fmtNumber(stats.usedQuota)} / ${fmtNumber(stats.totalQuota)}`}
          tone="green"
        />
        <StatCard
          icon={<AlertTriangle size={22} />}
          label="Sắp hết tin"
          value={fmtNumber(stats.low)}
          hint="Cần nhắc khách gia hạn"
          tone="amber"
        />
        <StatCard
          icon={<InfinityIcon size={22} />}
          label="Unlimited"
          value={fmtNumber(stats.unlimited)}
          hint={`${fmtNumber(stats.codesReady)} code còn dùng được`}
          tone="purple"
        />
      </section>

      {error && (
        <div className="smsx-alert">
          <XCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      <section className="smsx-toolbar">
        <div className="smsx-tabs">
          <button
            type="button"
            className={tab === "quota" ? "is-active" : ""}
            onClick={() => setTab("quota")}
          >
            <BarChart3 size={16} /> Quản lý tin
          </button>
          <button
            type="button"
            className={tab === "codes" ? "is-active" : ""}
            onClick={() => setTab("codes")}
          >
            <KeyRound size={16} /> Code dịch vụ
          </button>
          <button
            type="button"
            className={tab === "phones" ? "is-active" : ""}
            onClick={() => setTab("phones")}
          >
            <Phone size={16} /> Số nhận SMS
          </button>
        </div>

        <div className="smsx-search">
          <Search size={17} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm email, user, plan, code, số điện thoại..."
          />
        </div>
      </section>

      {tab === "quota" && (
        <section className="smsx-panel">
          <div className="smsx-panel__head">
            <div>
              <h2>Quota SMS theo account</h2>
              <p>Quản lý account còn bao nhiêu tin, đã dùng bao nhiêu và account nào sắp hết tin.</p>
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
            >
              <option value="">Tất cả trạng thái</option>
              <option value="sms">Chỉ account có SMS</option>
              <option value="active">Đang hoạt động</option>
              <option value="expired">Hết hạn</option>
              <option value="low">Sắp hết tin</option>
            </select>
          </div>

          <div className="smsx-table-wrap">
            <table className="smsx-table">
              <thead>
                <tr>
                  <th>Khách hàng</th>
                  <th>Gói</th>
                  <th>Quota SMS</th>
                  <th>Thời hạn</th>
                  <th>Feature</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 6 }).map((_, idx) => (
                    <tr key={idx}>
                      <td colSpan={6}>
                        <div className="smsx-skeleton" />
                      </td>
                    </tr>
                  ))
                ) : filteredSubs.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="smsx-empty">
                        <Sparkles size={26} />
                        <b>Không có account phù hợp</b>
                        <span>Thử đổi bộ lọc hoặc từ khóa tìm kiếm.</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredSubs.map((it, idx) => {
                    const plan = getPlanMeta(it.plan);
                    const low = isLowQuota(it);

                    return (
                      <tr key={`${it.userId}-${it.startedAtUtc || idx}`} className={low ? "is-low" : ""}>
                        <td>
                          <div className="smsx-user">
                            <span>{initials(it.userName, it.email)}</span>
                            <div>
                              <b>{getDisplayUser(it)}</b>
                              <small>{it.email || it.userId}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={`smsx-plan smsx-plan--${plan.tone}`}>{plan.label}</span>
                        </td>
                        <td>
                          <QuotaBar item={it} />
                        </td>
                        <td>
                          <div className="smsx-date">
                            <b>{Number(it.daysLeft || 0) > 0 ? `${it.daysLeft} ngày` : "Hết hạn"}</b>
                            <small>{fmtDateTime(it.endsAtUtc)}</small>
                          </div>
                        </td>
                        <td>
                          <FeatureChips features={it.features} />
                        </td>
                        <td>
                          <span className={`smsx-state ${it.isActive ? "is-ok" : "is-off"}`}>
                            {it.isActive ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                            {it.isActive ? "Active" : "Inactive"}
                          </span>
                          {low && (
                            <span className="smsx-state is-low">
                              <AlertTriangle size={14} /> Sắp hết tin
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="smsx-mobile-grid">
            {filteredSubs.map((it, idx) => {
              const plan = getPlanMeta(it.plan);
              const low = isLowQuota(it);

              return (
                <article className={`smsx-card ${low ? "is-low" : ""}`} key={`m-${it.userId}-${idx}`}>
                  <div className="smsx-card__top">
                    <div className="smsx-user">
                      <span>{initials(it.userName, it.email)}</span>
                      <div>
                        <b>{getDisplayUser(it)}</b>
                        <small>{it.email || it.userId}</small>
                      </div>
                    </div>
                    <span className={`smsx-plan smsx-plan--${plan.tone}`}>{plan.label}</span>
                  </div>
                  <QuotaBar item={it} />
                  <div className="smsx-card__meta">
                    <span>Hết hạn: <b>{fmtDateTime(it.endsAtUtc)}</b></span>
                    <span>Còn ngày: <b>{Number(it.daysLeft || 0)}</b></span>
                  </div>
                  <FeatureChips features={it.features} />
                </article>
              );
            })}
          </div>
        </section>
      )}

      {tab === "codes" && (
        <section className="smsx-codes-layout">
          <form className="smsx-create" onSubmit={handleCreateCode}>
            <div className="smsx-create__head">
              <span><PlusCircle size={18} /></span>
              <div>
                <h2>Tạo code dịch vụ</h2>
                <p>Code tạo ở đây sẽ cấp quyền SMS và quota khi khách nhập mã.</p>
              </div>
            </div>

            <label>
              Loại gói
              <select value={form.plan} onChange={(e) => applyPlan(e.target.value)}>
                {PLAN_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              {selectedPlan?.subtitle && <small>{selectedPlan.subtitle}</small>}
            </label>

            <div className="smsx-form-grid">
              <label>
                Code tuỳ chọn
                <input
                  value={form.code}
                  onChange={(e) => setForm((old) => ({ ...old, code: e.target.value.toUpperCase() }))}
                  placeholder="Bỏ trống để tự sinh"
                />
              </label>

              <label>
                Số ngày
                <input
                  type="number"
                  min={1}
                  value={form.durationDays}
                  onChange={(e) => setForm((old) => ({ ...old, durationDays: Number(e.target.value) }))}
                />
              </label>

              <label>
                Số lần kích hoạt
                <input
                  type="number"
                  min={1}
                  value={form.maxActivations}
                  onChange={(e) => setForm((old) => ({ ...old, maxActivations: Number(e.target.value) }))}
                />
              </label>

              <label>
                Gán riêng cho user
                <select
                  value={form.reservedForUserId}
                  onChange={(e) => setForm((old) => ({ ...old, reservedForUserId: e.target.value }))}
                >
                  <option value="">Không gán riêng</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.email || a.name || a.id}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="smsx-checkbox">
              <input
                id="smsUnlimited"
                type="checkbox"
                checked={form.smsUnlimited}
                onChange={(e) => setForm((old) => ({ ...old, smsUnlimited: e.target.checked }))}
              />
              <label htmlFor="smsUnlimited">Gói không giới hạn tin nhắn</label>
            </div>

            {!form.smsUnlimited && (
              <div className="smsx-form-grid">
                <label>
                  Tổng số tin SMS
                  <input
                    type="number"
                    min={1}
                    value={form.smsQuotaTotal}
                    onChange={(e) => setForm((old) => ({ ...old, smsQuotaTotal: e.target.value }))}
                  />
                </label>

                <label>
                  Cảnh báo khi còn
                  <input
                    type="number"
                    min={1}
                    value={form.smsWarnAtRemaining}
                    onChange={(e) => setForm((old) => ({ ...old, smsWarnAtRemaining: e.target.value }))}
                  />
                </label>
              </div>
            )}

            <label>
              Ghi chú
              <textarea
                rows={3}
                value={form.notes}
                onChange={(e) => setForm((old) => ({ ...old, notes: e.target.value }))}
                placeholder="Ví dụ: Gói 1000 tin SMS / 1 năm"
              />
            </label>

            <button type="submit" className="smsx-submit" disabled={savingCode}>
              {savingCode ? <Loader2 className="smsx-spin" size={18} /> : <ShieldCheck size={18} />}
              Tạo code
            </button>
          </form>

          <section className="smsx-panel">
            <div className="smsx-panel__head">
              <div>
                <h2>Danh sách code</h2>
                <p>Theo dõi code còn slot, đã dùng, quota SMS gắn với code.</p>
              </div>

              <label className="smsx-switch">
                <input
                  type="checkbox"
                  checked={onlyUnusedCodes}
                  onChange={(e) => setOnlyUnusedCodes(e.target.checked)}
                />
                <span>Chỉ code còn slot</span>
              </label>
            </div>

            <div className="smsx-code-list">
              {loading ? (
                Array.from({ length: 6 }).map((_, idx) => <div className="smsx-code-card skeleton" key={idx} />)
              ) : filteredCodes.length === 0 ? (
                <div className="smsx-empty">
                  <KeyRound size={28} />
                  <b>Không có code phù hợp</b>
                  <span>Tạo code mới hoặc bỏ bộ lọc.</span>
                </div>
              ) : (
                filteredCodes.map((c) => {
                  const plan = getPlanMeta(c.plan);
                  const remain = Number(c.remaining ?? Math.max(0, Number(c.maxActivations ?? 1) - Number(c.used ?? 0)));
                  const hasSlots = c.hasSlots ?? remain > 0;

                  return (
                    <article className={`smsx-code-card ${hasSlots ? "" : "is-used"}`} key={c.code}>
                      <div className="smsx-code-card__top">
                        <span className={`smsx-plan smsx-plan--${plan.tone}`}>{plan.label}</span>
                        <span className={`smsx-state ${hasSlots ? "is-ok" : "is-off"}`}>
                          {hasSlots ? <CheckCircle2 size={14} /> : <ClipboardCopy size={14} />}
                          {hasSlots ? "Còn slot" : "Đã dùng hết"}
                        </span>
                      </div>

                      <button className="smsx-code-value" type="button" onClick={() => void handleCopy(c.code)}>
                        <KeyRound size={17} />
                        <b>{c.code}</b>
                        <Copy size={15} />
                      </button>

                      <div className="smsx-code-card__grid">
                        <div>
                          <span>Quota</span>
                          <b>{c.smsUnlimited ? "Unlimited" : fmtNumber(c.smsQuotaTotal)}</b>
                        </div>
                        <div>
                          <span>Cảnh báo</span>
                          <b>{c.smsUnlimited ? "—" : fmtNumber(c.smsWarnAtRemaining)}</b>
                        </div>
                        <div>
                          <span>Đã dùng</span>
                          <b>{fmtNumber(c.used ?? 0)}</b>
                        </div>
                        <div>
                          <span>Còn slot</span>
                          <b>{fmtNumber(remain)}</b>
                        </div>
                      </div>

                      <FeatureChips features={c.features} />

                      <p className="smsx-note">{c.notes || "Không có ghi chú"}</p>

                      <div className="smsx-code-card__foot">
                        <span>{fmtDateTime(c.createdAtUtc)}</span>
                        <button type="button" className="smsx-danger" onClick={() => void handleDeleteCode(c.code)}>
                          <Trash2 size={15} /> Xoá
                        </button>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </section>
        </section>
      )}

      {tab === "phones" && (
        <section className="smsx-panel">
          <div className="smsx-panel__head">
            <div>
              <h2>Số điện thoại nhận SMS</h2>
              <p>Danh sách số nhận cảnh báo đã được user kích hoạt. API hiện tại lấy từ SmsActivations.</p>
            </div>
          </div>

          <div className="smsx-table-wrap">
            <table className="smsx-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Số điện thoại</th>
                  <th>License code</th>
                  <th>Kích hoạt</th>
                  <th>Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, idx) => (
                    <tr key={idx}>
                      <td colSpan={5}>
                        <div className="smsx-skeleton" />
                      </td>
                    </tr>
                  ))
                ) : filteredPhones.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      <div className="smsx-empty">
                        <Phone size={28} />
                        <b>Chưa có số SMS phù hợp</b>
                        <span>User cần kích hoạt số điện thoại nhận cảnh báo.</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredPhones.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div className="smsx-user">
                          <span>{initials(p.name, p.email)}</span>
                          <div>
                            <b>{p.name || p.email || p.userId}</b>
                            <small>{p.email || p.userId}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <button className="smsx-phone" type="button" onClick={() => void handleCopy(p.phone || "")}>
                          <Phone size={15} /> {p.phone || "—"}
                        </button>
                      </td>
                      <td>{p.licenseCode || "—"}</td>
                      <td>{fmtDateTime(p.activatedAtUtc)}</td>
                      <td>{p.notes || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
