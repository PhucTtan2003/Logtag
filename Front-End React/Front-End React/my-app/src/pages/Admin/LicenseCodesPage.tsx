// src/pages/Admin/LicenseCodesPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  adminListCodes,
  adminListAccounts,
  adminIssueCode,
  redeemForUser,
  type LicenseCodeItem,
  type AdminAccountItem,
  type IssueCodePayload,
} from "../../api/subscriptions";
import api from "../../api/axios";
import "../../styles/Admin/CodeService/LicenseCodesPage.css";

import {
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Filter,
  Infinity as InfinityIcon,
  KeyRound,
  Loader2,
  MessageSquareText,
  PlusCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TicketPercent,
  Trash2,
  UserCheck,
  Users,
  Zap,
} from "lucide-react";

type PlanKey =
  | "basic"
  | "pro"
  | "premium"
  | "sms"
  | "sms_schedule"
  | "sms_1000_year"
  | "sms_10000_year"
  | "sms_unlimited_year"
  | "sms_custom_year"
  | "sms_custom";

type ToastKind = "success" | "error" | "info";

type ToastState = {
  kind: ToastKind;
  message: string;
} | null;

type IssuePayloadWithSmsQuota = IssueCodePayload & {
  smsQuotaTotal?: number | null;
  smsUnlimited?: boolean;
  smsWarnAtRemaining?: number | null;
};

type PlanMeta = {
  title: string;
  subtitle: string;
  tone: string;
  durationDays: number;
  features: string[];
  smsQuotaTotal?: number | null;
  smsUnlimited?: boolean;
  smsWarnAtRemaining?: number | null;
  notes: string;
};

const FEATURE_SMS_ALERT = "sms_alert";
const FEATURE_SMS_SCHEDULE = "sms_schedule";

const PLAN_META: Record<PlanKey, PlanMeta> = {
  basic: {
    title: "Basic",
    subtitle: "Gói nền tảng",
    tone: "basic",
    durationDays: 180,
    features: [],
    notes: "Gói Basic",
  },
  pro: {
    title: "Pro LTGEO",
    subtitle: "Thiết bị nâng cao",
    tone: "pro",
    durationDays: 180,
    features: ["advanced_devices", "alert_history_90d", "priority_alerts"],
    notes: "Gói Pro LTGEO",
  },
  premium: {
    title: "Premium",
    subtitle: "Full quyền vận hành",
    tone: "premium",
    durationDays: 365,
    features: [
      "advanced_devices",
      "alert_history_90d",
      "priority_alerts",
      "advanced_export",
      FEATURE_SMS_ALERT,
      FEATURE_SMS_SCHEDULE,
    ],
    smsQuotaTotal: null,
    smsUnlimited: true,
    smsWarnAtRemaining: null,
    notes: "Gói Premium full quyền / 1 năm",
  },
  sms: {
    title: "SMS Alert",
    subtitle: "Cảnh báo SMS cơ bản",
    tone: "sms",
    durationDays: 180,
    features: [FEATURE_SMS_ALERT],
    smsQuotaTotal: 1000,
    smsUnlimited: false,
    smsWarnAtRemaining: 100,
    notes: "Gói SMS cảnh báo",
  },
  sms_schedule: {
    title: "SMS định kỳ",
    subtitle: "SMS cảnh báo + lịch gửi",
    tone: "schedule",
    durationDays: 180,
    features: [FEATURE_SMS_ALERT, FEATURE_SMS_SCHEDULE],
    smsQuotaTotal: 1000,
    smsUnlimited: false,
    smsWarnAtRemaining: 100,
    notes: "Gói SMS định kỳ",
  },
  sms_1000_year: {
    title: "SMS 1.000 tin / năm",
    subtitle: "Phù hợp khách dùng ít",
    tone: "sms",
    durationDays: 365,
    features: [FEATURE_SMS_ALERT],
    smsQuotaTotal: 1000,
    smsUnlimited: false,
    smsWarnAtRemaining: 100,
    notes: "Gói 1000 tin SMS / 1 năm",
  },
  sms_10000_year: {
    title: "SMS 10.000 tin / năm",
    subtitle: "Phù hợp kho nhiều thiết bị",
    tone: "pro",
    durationDays: 365,
    features: [FEATURE_SMS_ALERT],
    smsQuotaTotal: 10000,
    smsUnlimited: false,
    smsWarnAtRemaining: 500,
    notes: "Gói 10000 tin SMS / 1 năm",
  },
  sms_unlimited_year: {
    title: "SMS không giới hạn / năm",
    subtitle: "Không giới hạn số tin",
    tone: "premium",
    durationDays: 365,
    features: [FEATURE_SMS_ALERT],
    smsQuotaTotal: null,
    smsUnlimited: true,
    smsWarnAtRemaining: null,
    notes: "Gói SMS không giới hạn / 1 năm",
  },
  sms_custom_year: {
    title: "SMS tùy số lượng / năm",
    subtitle: "Admin nhập quota theo hợp đồng",
    tone: "sms",
    durationDays: 365,
    features: [FEATURE_SMS_ALERT, FEATURE_SMS_SCHEDULE],
    smsQuotaTotal: 10000,
    smsUnlimited: false,
    smsWarnAtRemaining: 500,
    notes: "Gói SMS tùy số lượng / 1 năm",
  },
  sms_custom: {
    title: "SMS custom",
    subtitle: "Admin tự nhập quota",
    tone: "schedule",
    durationDays: 365,
    features: [FEATURE_SMS_ALERT],
    smsQuotaTotal: 5000,
    smsUnlimited: false,
    smsWarnAtRemaining: 300,
    notes: "Gói SMS custom",
  },
};

const PLAN_OPTIONS: PlanKey[] = [
  "sms_custom_year",
  "sms_unlimited_year",
  "sms_1000_year",
  "sms_10000_year",
  "sms_custom",
  "sms",
  "sms_schedule",
  "pro",
  "premium",
  "basic",
];

// Form tạo mới chỉ giữ một gói SMS tùy số lượng và một gói không giới hạn.
// Các plan 1.000/10.000 vẫn được giữ để hiển thị và lọc code cũ.
const ISSUE_PLAN_OPTIONS: PlanKey[] = [
  "sms_custom_year",
  "sms_unlimited_year",
  "pro",
  "premium",
  "basic",
];

const PLAN_FILTER_OPTIONS: Array<"all" | PlanKey> = ["all", ...PLAN_OPTIONS];

const featureLabel = (f: string) => {
  const map: Record<string, string> = {
    advanced_devices: "Thiết bị nâng cao",
    alert_history_90d: "Lịch sử 90 ngày",
    priority_alerts: "Cảnh báo ưu tiên",
    advanced_export: "Xuất nâng cao",
    sms_alert: "SMS cảnh báo",
    sms_schedule: "SMS định kỳ",
  };
  return map[f] || f;
};

const normalizeText = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const fmtNumber = (value?: number | null) => {
  if (value === null || value === undefined) return "—";
  if (!Number.isFinite(value)) return "Không giới hạn";
  return new Intl.NumberFormat("vi-VN").format(value);
};

const suggestSmsWarnAt = (total: number) => {
  if (!Number.isFinite(total) || total <= 0) return 1;
  if (total >= 10000) return 500;
  if (total >= 1000) return 100;
  return Math.max(1, Math.ceil(total * 0.1));
};

const formatDateTime = (input?: string) => {
  if (!input) return "—";
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("vi-VN", { hour12: false });
};

const planMetaOf = (plan?: string) => {
  const key = String(plan || "basic") as PlanKey;
  return PLAN_META[key] ?? PLAN_META.basic;
};

const safeRemaining = (c: LicenseCodeItem) => {
  const remain = Number((c as any).remaining);
  if (Number.isFinite(remain)) return remain;

  const max = Number((c as any).maxActivations ?? 1);
  const used = Number((c as any).used ?? 0);
  return Math.max(0, max - used);
};

const getCodeState = (c: LicenseCodeItem) => {
  const remaining = safeRemaining(c);
  const hasSlots = (c as any).hasSlots ?? remaining > 0;

  if (!hasSlots || remaining <= 0) {
    return {
      key: "used",
      label: "Đã dùng hết",
      icon: <ClipboardCheck size={14} />,
    };
  }

  return {
    key: "ready",
    label: "Sẵn sàng",
    icon: <CheckCircle2 size={14} />,
  };
};

const accountLabel = (a?: AdminAccountItem) => {
  if (!a) return "Không gán tài khoản";
  return a.email || a.name || a.id;
};

const smsQuotaLabelOfCode = (c: LicenseCodeItem) => {
  const anyCode = c as any;
  if (anyCode.smsUnlimited === true) return "Không giới hạn";

  const total = Number(anyCode.smsQuotaTotal);
  if (Number.isFinite(total) && total > 0) return `${fmtNumber(total)} tin`;

  const meta = planMetaOf(c.plan);
  if (meta.smsUnlimited) return "Không giới hạn";
  if (Number.isFinite(meta.smsQuotaTotal as number)) return `${fmtNumber(meta.smsQuotaTotal)} tin`;

  return "—";
};

function LicenseToast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(onClose, 2500);
    return () => window.clearTimeout(timer);
  }, [toast, onClose]);

  if (!toast) return null;

  return (
    <div className={`lcx-toast lcx-toast--${toast.kind}`} role="status" aria-live="polite">
      <span className="lcx-toast__icon">
        {toast.kind === "success" ? "✓" : toast.kind === "error" ? "!" : "i"}
      </span>
      <div className="lcx-toast__body">
        <b>
          {toast.kind === "success"
            ? "Thành công"
            : toast.kind === "error"
            ? "Cần kiểm tra"
            : "Thông báo"}
        </b>
        <span>{toast.message}</span>
      </div>
    </div>
  );
}

export default function LicenseCodesPage() {
  const [codes, setCodes] = useState<LicenseCodeItem[]>([]);
  const [accounts, setAccounts] = useState<AdminAccountItem[]>([]);

  const [onlyUnused, setOnlyUnused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const [plan, setPlan] = useState<PlanKey>("sms_custom_year");
  const [durationDays, setDurationDays] = useState<number>(365);
  const [notes, setNotes] = useState<string>(PLAN_META.sms_custom_year.notes);
  const [maxActivations, setMaxActivations] = useState<number>(1);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [autoActivate, setAutoActivate] = useState<boolean>(false);

  const [customSmsQuotaTotal, setCustomSmsQuotaTotal] = useState<number>(10000);
  const [customSmsWarnAtRemaining, setCustomSmsWarnAtRemaining] = useState<number>(500);

  const [query, setQuery] = useState("");
  const [planFilter, setPlanFilter] = useState<"all" | PlanKey>("all");
  const [toast, setToast] = useState<ToastState>(null);

  const planMeta = PLAN_META[plan];

  const featuresByPlan = useMemo(() => planMeta.features ?? [], [planMeta]);
  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId),
    [accounts, selectedAccountId]
  );

  const isCustomSmsPlan = plan === "sms_custom_year" || plan === "sms_custom";
  const isSmsPlan =
    featuresByPlan.includes(FEATURE_SMS_ALERT) ||
    featuresByPlan.includes(FEATURE_SMS_SCHEDULE);

  const resolvedSmsQuota = useMemo(() => {
    if (plan === "sms_custom_year" || plan === "sms_custom") {
      return {
        smsUnlimited: false,
        smsQuotaTotal: customSmsQuotaTotal,
        smsWarnAtRemaining: customSmsWarnAtRemaining,
      };
    }

    return {
      smsUnlimited: planMeta.smsUnlimited === true,
      smsQuotaTotal: planMeta.smsUnlimited ? null : planMeta.smsQuotaTotal ?? null,
      smsWarnAtRemaining: planMeta.smsUnlimited ? null : planMeta.smsWarnAtRemaining ?? null,
    };
  }, [customSmsQuotaTotal, customSmsWarnAtRemaining, plan, planMeta]);

  const previewTitle = useMemo(() => {
    if (isCustomSmsPlan) {
      const period = durationDays === 365 ? "năm" : `${durationDays} ngày`;
      return `SMS ${fmtNumber(customSmsQuotaTotal)} tin / ${period}`;
    }

    return planMeta.title;
  }, [customSmsQuotaTotal, durationDays, isCustomSmsPlan, planMeta.title]);

  const previewSubtitle = useMemo(() => {
    if (isCustomSmsPlan) {
      return `Cảnh báo sắp hết khi còn ${fmtNumber(customSmsWarnAtRemaining)} tin`;
    }

    return planMeta.subtitle;
  }, [customSmsWarnAtRemaining, isCustomSmsPlan, planMeta.subtitle]);

  const showToast = (kind: ToastKind, message: string) => {
    setToast({ kind, message });
  };

  const loadAccounts = async () => {
    try {
      const items = await adminListAccounts();
      setAccounts(items);
    } catch (e) {
      console.warn("Load accounts failed:", e);
    }
  };

  const loadCodes = async () => {
    setLoading(true);
    try {
      const res = await adminListCodes({ onlyUnused, skip: 0, take: 200 });
      const sorted = (res.items ?? [])
        .slice()
        .sort((a: any, b: any) => {
          const ta = a.createdAtUtc ? new Date(a.createdAtUtc).getTime() : 0;
          const tb = b.createdAtUtc ? new Date(b.createdAtUtc).getTime() : 0;
          if (tb !== ta) return tb - ta;
          return String(b._id ?? "").localeCompare(String(a._id ?? ""));
        });

      setCodes(sorted);
    } catch (e: any) {
      console.error("Load codes failed:", e);
      showToast(
        "error",
        e?.response?.data?.message || "Không tải được danh sách license code."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAccounts();
  }, []);

  useEffect(() => {
    void loadCodes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyUnused]);

  const stats = useMemo(() => {
    const total = codes.length;
    const ready = codes.filter((c) => getCodeState(c).key === "ready").length;
    const used = total - ready;
    const sms = codes.filter((c) =>
      (c.features ?? []).some((f) => f === FEATURE_SMS_ALERT || f === FEATURE_SMS_SCHEDULE)
    ).length;

    return { total, ready, used, sms };
  }, [codes]);

  const filteredCodes = useMemo(() => {
    const keyword = normalizeText(query);

    return codes.filter((c) => {
      if (planFilter !== "all" && c.plan !== planFilter) return false;
      if (!keyword) return true;

      const haystack = [
        c.code,
        c.plan,
        c.notes,
        smsQuotaLabelOfCode(c),
        ...(c.features ?? []),
        c.createdAtUtc,
      ]
        .map(normalizeText)
        .join(" ");

      return haystack.includes(keyword);
    });
  }, [codes, planFilter, query]);

  const handlePlanChange = (nextPlan: PlanKey) => {
    const nextMeta = PLAN_META[nextPlan];
    setPlan(nextPlan);
    setDurationDays(nextMeta.durationDays);

    // Chỉ tự đổi note khi note đang rỗng hoặc đang là note mẫu của gói cũ.
    const oldNotes = Object.values(PLAN_META).map((x) => x.notes);
    if (!notes.trim() || oldNotes.includes(notes.trim())) {
      setNotes(nextMeta.notes);
    }

    if (nextPlan === "sms_custom_year" || nextPlan === "sms_custom") {
      setCustomSmsQuotaTotal(Number(nextMeta.smsQuotaTotal ?? 5000));
      setCustomSmsWarnAtRemaining(Number(nextMeta.smsWarnAtRemaining ?? 300));
    }
  };

  const onIssue = async () => {
    const cleanDuration = Number(durationDays);
    const cleanMaxActivations = Number(maxActivations);

    if (!Number.isFinite(cleanDuration) || cleanDuration < 1 || cleanDuration > 3650) {
      showToast("error", "Thời hạn phải nằm trong khoảng 1 đến 3650 ngày.");
      return;
    }

    if (!Number.isFinite(cleanMaxActivations) || cleanMaxActivations < 1 || cleanMaxActivations > 1000) {
      showToast("error", "Số lần kích hoạt phải nằm trong khoảng 1 đến 1000.");
      return;
    }

    if (autoActivate && !selectedAccountId) {
      showToast("error", "Muốn kích hoạt ngay thì cần chọn tài khoản trước.");
      return;
    }

    if (isSmsPlan && !resolvedSmsQuota.smsUnlimited) {
      const quota = Number(resolvedSmsQuota.smsQuotaTotal);
      const warn = Number(resolvedSmsQuota.smsWarnAtRemaining ?? 0);

      if (!Number.isFinite(quota) || quota < 1) {
        showToast("error", "Số lượng SMS của gói phải lớn hơn 0.");
        return;
      }

      if (!Number.isFinite(warn) || warn < 0 || warn > quota) {
        showToast("error", "Mốc cảnh báo sắp hết tin phải nằm từ 0 đến quota của gói.");
        return;
      }
    }

    setCreating(true);
    try {
      const payload: IssuePayloadWithSmsQuota = {
        plan,
        features: featuresByPlan,
        durationDays: cleanDuration,
        maxActivations: cleanMaxActivations,
        notes: notes.trim() || planMeta.notes,
        reservedForUserId: selectedAccountId.trim() || undefined,
        smsQuotaTotal: resolvedSmsQuota.smsQuotaTotal,
        smsUnlimited: resolvedSmsQuota.smsUnlimited,
        smsWarnAtRemaining: resolvedSmsQuota.smsWarnAtRemaining,
      };

      const issued = await adminIssueCode(payload as IssueCodePayload);

      if (autoActivate && selectedAccountId) {
        await redeemForUser(issued.code, selectedAccountId);
        showToast("success", `Đã tạo và kích hoạt code ${issued.code}`);
      } else {
        showToast("success", `Đã tạo code ${issued.code}`);
      }

      await loadCodes();
    } catch (e: any) {
      showToast("error", e?.response?.data?.message || "Tạo code thất bại.");
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      showToast("success", `Đã copy: ${code}`);
    } catch {
      showToast("error", "Trình duyệt chưa cho phép copy tự động.");
    }
  };

  const handleDelete = async (code: string) => {
    const ok = window.confirm(
      `Bạn chắc chắn muốn xoá code ${code}?\nCode này sẽ không thể dùng để mở khoá dịch vụ nữa.`
    );
    if (!ok) return;

    try {
      await api.delete(`/api/admin/license-codes/${encodeURIComponent(code)}`);
      setCodes((prev) => prev.filter((c) => c.code !== code));
      showToast("success", `Đã xoá code ${code}`);
    } catch (e: any) {
      showToast(
        "error",
        e?.response?.data?.message || "Xoá code thất bại. Vui lòng thử lại."
      );
    }
  };

  return (
    <div className="license-container license-codes-page lcx-page">
      <section className="lcx-hero">
        <div className="lcx-hero__brand">
          <div className="lcx-logo-wrap">
            <img src="/Pictures/logo.png" alt="SMARTTECH" className="lcx-logo" />
          </div>

          <div className="lcx-hero__copy">
            <span className="lcx-kicker">
              <TicketPercent size={15} /> License Command Center
            </span>
            <h1>Quản lý license & mã kích hoạt</h1>
            <p>
              Tạo một gói SMS linh hoạt theo đúng số lượng khách mua, không còn bị giới hạn ở mốc 1.000 hoặc 10.000 tin.
            </p>
          </div>
        </div>

        <div className="lcx-hero__actions">
          <button
            type="button"
            className="lcx-btn lcx-btn--ghost"
            onClick={() => (window.location.href = "/admin")}
          >
            <ArrowLeft size={17} /> Trở về Admin
          </button>

          <button
            type="button"
            className="lcx-btn lcx-btn--soft"
            onClick={() => void loadCodes()}
            disabled={loading}
          >
            {loading ? <Loader2 size={17} className="lcx-spin" /> : <RefreshCw size={17} />}
            {loading ? "Đang tải" : "Làm mới"}
          </button>
        </div>
      </section>

      <section className="lcx-stats" aria-label="Thống kê license">
        <div className="lcx-stat-card">
          <span className="lcx-stat-card__icon"><KeyRound size={20} /></span>
          <div>
            <p>Tổng code</p>
            <b>{stats.total}</b>
          </div>
        </div>
        <div className="lcx-stat-card lcx-stat-card--ready">
          <span className="lcx-stat-card__icon"><CheckCircle2 size={20} /></span>
          <div>
            <p>Còn slot</p>
            <b>{stats.ready}</b>
          </div>
        </div>
        <div className="lcx-stat-card lcx-stat-card--used">
          <span className="lcx-stat-card__icon"><ClipboardCheck size={20} /></span>
          <div>
            <p>Đã dùng</p>
            <b>{stats.used}</b>
          </div>
        </div>
        <div className="lcx-stat-card lcx-stat-card--sms">
          <span className="lcx-stat-card__icon"><Zap size={20} /></span>
          <div>
            <p>Gói SMS</p>
            <b>{stats.sms}</b>
          </div>
        </div>
      </section>

      <section className="lcx-create-card">
        <div className="lcx-create-card__head">
          <div>
            <span className="lcx-kicker"><Sparkles size={15} /> Issue New Code</span>
            <h2>Tạo mã kích hoạt mới</h2>
          </div>

          <div className={`lcx-plan-preview lcx-plan-preview--${planMeta.tone}`}>
            {resolvedSmsQuota.smsUnlimited ? <InfinityIcon size={18} /> : <ShieldCheck size={18} />}
            <div>
              <b>{previewTitle}</b>
              <span>{previewSubtitle}</span>
            </div>
          </div>
        </div>

        <form
          className="lcx-form lcx-form--issue"
          onSubmit={(e) => {
            e.preventDefault();
            void onIssue();
          }}
        >
          <label className="lcx-field lcx-field--plan">
            <span>Chọn gói dịch vụ</span>
            <select value={plan} onChange={(e) => handlePlanChange(e.target.value as PlanKey)}>
              {ISSUE_PLAN_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {PLAN_META[p].title} — {PLAN_META[p].subtitle}
                </option>
              ))}
            </select>
          </label>

          <label className="lcx-field lcx-field--duration">
            <span>Thời hạn</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={3650}
              value={durationDays}
              onChange={(e) => setDurationDays(parseInt(e.target.value || "0", 10))}
            />
            <small>Gói năm mặc định là 365 ngày.</small>
          </label>

          {isCustomSmsPlan && (
            <>
              <label className="lcx-field lcx-field--activation">
                <span>Số lượng tin SMS</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={10000000}
                  step={1}
                  value={customSmsQuotaTotal}
                  onChange={(e) => {
                    const nextQuota = Math.max(
                      1,
                      parseInt(e.target.value || "1", 10)
                    );
                    setCustomSmsQuotaTotal(nextQuota);
                    setCustomSmsWarnAtRemaining(suggestSmsWarnAt(nextQuota));
                  }}
                  placeholder="Ví dụ: 2500"
                />
                <small>Nhập đúng số lượng khách hàng đã mua.</small>
              </label>

              <label className="lcx-field lcx-field--activation">
                <span>Cảnh báo khi còn</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={customSmsQuotaTotal}
                  step={1}
                  value={customSmsWarnAtRemaining}
                  onChange={(e) =>
                    setCustomSmsWarnAtRemaining(
                      Math.max(0, parseInt(e.target.value || "0", 10))
                    )
                  }
                  placeholder="Ví dụ: 250"
                />
                <small>Hệ thống sẽ báo khi quota chạm mốc này.</small>
              </label>
            </>
          )}

          <label className="lcx-field lcx-field--activation">
            <span>Số lần kích hoạt</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={1000}
              value={maxActivations}
              onChange={(e) => setMaxActivations(parseInt(e.target.value || "1", 10))}
            />
            <small>Thường để 1 code / 1 khách.</small>
          </label>

          <label className="lcx-field lcx-field--account">
            <span>Gán cho tài khoản</span>
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
            >
              <option value="">Không chọn — khách tự redeem</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {accountLabel(a)}
                </option>
              ))}
            </select>
            <small>{accountLabel(selectedAccount)}</small>
          </label>

          <label className="lcx-field lcx-field--notes">
            <span>Ghi chú</span>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ví dụ: Khách kho lạnh A, gia hạn tháng này..."
            />
          </label>

          {isSmsPlan && (
            <div className="lcx-feature-box">
              <div className="lcx-feature-box__title">
                <MessageSquareText size={15} /> Hạn mức SMS sẽ cấp
              </div>

              <div className="lcx-feature-chips">
                {resolvedSmsQuota.smsUnlimited ? (
                  <span>Không giới hạn số tin SMS</span>
                ) : (
                  <>
                    <span>
                      Tổng quota: {fmtNumber(resolvedSmsQuota.smsQuotaTotal)} tin
                    </span>
                    <span>
                      Cảnh báo khi còn{" "}
                      {fmtNumber(resolvedSmsQuota.smsWarnAtRemaining)} tin
                    </span>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="lcx-feature-box">
            <div className="lcx-feature-box__title">
              <Sparkles size={15} /> Tính năng mở khoá
            </div>
            <div className="lcx-feature-chips">
              {featuresByPlan.length ? (
                featuresByPlan.map((f) => <span key={f}>{featureLabel(f)}</span>)
              ) : (
                <span>Không có tính năng nâng cao</span>
              )}
            </div>
          </div>

          <div className="lcx-form-actions">
            <label className={`lcx-switch ${!selectedAccountId ? "is-muted" : ""}`}>
              <input
                type="checkbox"
                checked={autoActivate}
                onChange={(e) => setAutoActivate(e.target.checked)}
              />
              <span />
              <em>Kích hoạt ngay</em>
            </label>

            <button type="submit" className="lcx-btn lcx-btn--primary" disabled={creating}>
              {creating ? <Loader2 size={17} className="lcx-spin" /> : <PlusCircle size={17} />}
              {creating ? "Đang tạo..." : "Tạo code"}
            </button>
          </div>
        </form>
      </section>

      <section className="lcx-control-bar">
        <div className="lcx-search">
          <Search size={17} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm code, plan, quota, ghi chú, feature..."
          />
        </div>

        <label className="lcx-filter-select">
          <Filter size={16} />
          <select value={planFilter} onChange={(e) => setPlanFilter(e.target.value as any)}>
            <option value="all">Tất cả plan</option>
            {PLAN_FILTER_OPTIONS.filter((p): p is PlanKey => p !== "all").map((p) => (
              <option key={p} value={p}>{PLAN_META[p].title}</option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className={`lcx-chip-toggle ${onlyUnused ? "is-active" : ""}`}
          onClick={() => setOnlyUnused((v) => !v)}
        >
          <CheckCircle2 size={16} /> Chỉ code còn slot
        </button>
      </section>

      <section className="lcx-list-card">
        <div className="lcx-list-card__head">
          <div>
            <h2>Danh sách mã kích hoạt</h2>
            <p>
              Đang hiển thị <b>{filteredCodes.length}</b> / {codes.length} code.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="lcx-skeleton-list" aria-label="Đang tải dữ liệu">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} />)}
          </div>
        ) : filteredCodes.length === 0 ? (
          <div className="lcx-empty">
            <div className="lcx-empty__icon"><TicketPercent size={30} /></div>
            <b>Không có code phù hợp</b>
            <span>Thử đổi bộ lọc, từ khoá tìm kiếm hoặc bấm làm mới.</span>
          </div>
        ) : (
          <>
            <div className="lcx-table-shell">
              <table className="lcx-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Gói dịch vụ</th>
                    <th>Quota SMS</th>
                    <th>Tính năng</th>
                    <th>Thời hạn</th>
                    <th>Trạng thái</th>
                    <th>Ghi chú</th>
                    <th>Ngày tạo</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCodes.map((c) => {
                    const state = getCodeState(c);
                    const meta = planMetaOf(c.plan);

                    return (
                      <tr key={c.code}>
                        <td className="lcx-code-cell">
                          <span>{c.code}</span>
                          <button type="button" onClick={() => void handleCopy(c.code)} title="Copy code">
                            <Copy size={15} />
                          </button>
                        </td>
                        <td>
                          <span className={`lcx-plan-pill lcx-plan-pill--${meta.tone}`}>
                            {meta.title}
                          </span>
                        </td>
                        <td>
                          <span className="lcx-state-pill lcx-state-pill--ready">
                            {smsQuotaLabelOfCode(c)}
                          </span>
                        </td>
                        <td>
                          <div className="lcx-feature-inline">
                            {c.features?.length ? c.features.map((f) => <span key={f}>{featureLabel(f)}</span>) : <span>None</span>}
                          </div>
                        </td>
                        <td>{c.durationDays} ngày</td>
                        <td>
                          <span className={`lcx-state-pill lcx-state-pill--${state.key}`}>
                            {state.icon} {state.label}
                          </span>
                        </td>
                        <td className="lcx-muted-cell">{c.notes || "—"}</td>
                        <td>{formatDateTime(c.createdAtUtc)}</td>
                        <td>
                          <button
                            type="button"
                            className="lcx-icon-danger"
                            onClick={() => void handleDelete(c.code)}
                            title="Xoá code"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="lcx-mobile-list">
              {filteredCodes.map((c) => {
                const state = getCodeState(c);
                const meta = planMetaOf(c.plan);

                return (
                  <article className="lcx-mobile-code" key={c.code}>
                    <div className="lcx-mobile-code__top">
                      <div>
                        <span className={`lcx-plan-pill lcx-plan-pill--${meta.tone}`}>{meta.title}</span>
                        <h3>{c.code}</h3>
                      </div>
                      <span className={`lcx-state-pill lcx-state-pill--${state.key}`}>{state.icon} {state.label}</span>
                    </div>

                    <div className="lcx-mobile-code__features">
                      <span>Quota SMS: {smsQuotaLabelOfCode(c)}</span>
                    </div>

                    <div className="lcx-mobile-code__features">
                      {c.features?.length ? c.features.map((f) => <span key={f}>{featureLabel(f)}</span>) : <span>Không có feature</span>}
                    </div>

                    <div className="lcx-mobile-code__meta">
                      <span><UserCheck size={14} /> {c.durationDays} ngày</span>
                      <span><Users size={14} /> {formatDateTime(c.createdAtUtc)}</span>
                    </div>

                    {c.notes && <p>{c.notes}</p>}

                    <div className="lcx-mobile-code__actions">
                      <button type="button" onClick={() => void handleCopy(c.code)}>
                        <Copy size={15} /> Copy
                      </button>
                      <button type="button" className="danger" onClick={() => void handleDelete(c.code)}>
                        <Trash2 size={15} /> Xoá
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </section>

      <LicenseToast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}