// src/api/subscriptions.ts
import api from "./axios";

/** ========= Types ========= */
export type MeResp = {
  active: boolean;
  plan: string;
  features: string[];
  startedAtUtc?: string;
  endsAtUtc?: string;
  daysLeft?: number;
  isActive?: boolean;

  smsQuotaTotal?: number | null;
  smsQuotaUsed?: number;
  smsUnlimited?: boolean;
  smsRemaining?: number | null;
  smsWarnAtRemaining?: number | null;
  smsIsLow?: boolean;
  smsLowQuotaWarned?: boolean;
  lastSmsSentAtUtc?: string | null;
};

export type AdminSubsItem = {
  userId: string;
  userName?: string | null;
  email?: string | null;
  plan: string;
  features: string[];
  startedAtUtc: string;
  endsAtUtc: string;
  isActive: boolean;
  daysLeft: number;

  smsQuotaTotal?: number | null;
  smsQuotaUsed?: number;
  smsUnlimited?: boolean;
  smsRemaining?: number | null;
  smsWarnAtRemaining?: number | null;
  smsIsLow?: boolean;
  smsLowQuotaWarned?: boolean;
  lastSmsSentAtUtc?: string | null;
};

export type AdminSubsListResp = {
  total: number;
  items: AdminSubsItem[];
};

export type LicenseCodeItem = {
  code: string;
  plan: string;
  features: string[];
  durationDays: number;
  maxActivations: number;

  smsQuotaTotal?: number | null;
  smsUnlimited?: boolean;
  smsWarnAtRemaining?: number | null;

  used: number;
  remaining: number;
  hasSlots: boolean;
  notes?: string | null;
  createdAtUtc: string;
  createdBy?: unknown;
};

export type AdminLicenseItem = LicenseCodeItem;

export type LicenseCodeListResp = {
  total: number;
  items: LicenseCodeItem[];
};

export type IssueCodePayload = {
  code?: string;
  plan?: string;
  features?: string[];
  durationDays?: number;
  maxActivations?: number;

  smsQuotaTotal?: number | null;
  smsUnlimited?: boolean;
  smsWarnAtRemaining?: number | null;

  notes?: string;
  createdBy?: string;
  reservedForUserId?: string;
};

/** ========= User endpoints ========= */
export async function getMe(): Promise<MeResp> {
  // /api/subscriptions/me chịu trách nhiệm plan, features và thời hạn.
  // /api/sms/quota/me chịu trách nhiệm quota SMS.
  // Gộp hai response tại một nơi để toàn bộ component dùng
  // useSubscriptionCtx() đều nhận được cùng dữ liệu.
  const subscriptionResponse = await api.get<MeResp>(
    "/api/subscriptions/me",
    {
      params: { _ts: Date.now() },
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
    },
  );

  const subscription =
    (subscriptionResponse.data ?? {}) as MeResp;

  try {
    const quotaResponse = await api.get<
      Partial<MeResp> & {
        hasSubscription?: boolean;
        smsEnabled?: boolean;
        shouldRenew?: boolean;
        renewMessage?: string | null;
        reason?: string | null;
      }
    >("/api/sms/quota/me", {
      params: { _ts: Date.now() },
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
    });

    const quota = quotaResponse.data ?? {};

    return {
      ...subscription,

      // Giữ plan/features từ subscription, chỉ fallback sang quota
      // khi endpoint subscription chưa trả.
      plan: subscription.plan || quota.plan || "basic",
      features:
        Array.isArray(subscription.features) &&
        subscription.features.length > 0
          ? subscription.features
          : Array.isArray(quota.features)
            ? quota.features
            : [],

      isActive:
        subscription.isActive ??
        subscription.active ??
        quota.isActive ??
        quota.active ??
        false,

      active:
        subscription.active ??
        subscription.isActive ??
        quota.active ??
        quota.isActive ??
        false,

      daysLeft:
        subscription.daysLeft ??
        quota.daysLeft,

      endsAtUtc:
        subscription.endsAtUtc ??
        quota.endsAtUtc,

      smsQuotaTotal:
        quota.smsQuotaTotal ??
        subscription.smsQuotaTotal ??
        null,

      smsQuotaUsed:
        quota.smsQuotaUsed ??
        subscription.smsQuotaUsed ??
        0,

      smsUnlimited:
        quota.smsUnlimited ??
        subscription.smsUnlimited ??
        false,

      smsRemaining:
        quota.smsRemaining ??
        subscription.smsRemaining ??
        null,

      smsWarnAtRemaining:
        quota.smsWarnAtRemaining ??
        subscription.smsWarnAtRemaining ??
        null,

      smsIsLow:
        quota.smsIsLow ??
        subscription.smsIsLow ??
        false,

      smsLowQuotaWarned:
        quota.smsLowQuotaWarned ??
        subscription.smsLowQuotaWarned ??
        false,

      lastSmsSentAtUtc:
        quota.lastSmsSentAtUtc ??
        subscription.lastSmsSentAtUtc ??
        null,
    };
  } catch (error: any) {
    // Không làm hỏng toàn bộ trang nếu riêng quota API tạm lỗi.
    // Plan/thời hạn vẫn hiển thị từ /api/subscriptions/me.
    console.warn(
      "[subscriptions.getMe] SMS quota endpoint failed:",
      error?.response?.status,
      error?.response?.data ?? error,
    );

    return subscription;
  }
}

export async function redeemCode(code: string, userId?: string) {
  const normalizedCode = code.trim().toUpperCase();
  const headers: Record<string, string> = {};

  if (userId) {
    headers["X-User-Id"] = userId;
    headers.accountId = userId;
  }

  const res = await api.post(
    "/api/subscriptions/redeem",
    { code: normalizedCode },
    Object.keys(headers).length ? { headers } : undefined,
  );

  return res.data as {
    plan: string;
    features: string[];
    startedAtUtc: string;
    endsAtUtc: string;

    smsQuotaTotal?: number | null;
    smsQuotaUsed?: number;
    smsUnlimited?: boolean;
    smsRemaining?: number | null;
    smsWarnAtRemaining?: number | null;
  };
}

/** ========= Admin endpoints ========= */
export async function adminListSubs(
  status?: "active" | "expired",
): Promise<AdminSubsListResp> {
  const res = await api.get("/api/admin/subscriptions", {
    params: status ? { status } : undefined,
  });

  const data = res.data ?? { total: 0, items: [] };
  data.items = Array.isArray(data.items) ? data.items : [];

  return data as AdminSubsListResp;
}

export async function adminListCodes(
  opts?: boolean | { onlyUnused?: boolean; skip?: number; take?: number },
): Promise<LicenseCodeListResp> {
  let params: Record<string, unknown> = {};

  if (typeof opts === "boolean") {
    params = { onlyUnused: opts };
  } else if (opts) {
    params = {
      onlyUnused: opts.onlyUnused ?? false,
      skip: opts.skip ?? 0,
      take: opts.take ?? 50,
    };
  }

  const res = await api.get("/api/admin/license-codes", { params });
  const data = res.data ?? { total: 0, items: [] };

  data.items = Array.isArray(data.items) ? data.items : [];

  return data as LicenseCodeListResp;
}

export async function adminIssueCode(payload: IssueCodePayload) {
  const res = await api.post("/api/admin/license-codes/issue", payload);

  return res.data as {
    message: string;
    code: string;
    plan: string;
    features: string[];
    durationDays: number;
    remaining: number;

    smsQuotaTotal?: number | null;
    smsUnlimited?: boolean;
    smsWarnAtRemaining?: number | null;

    notes?: string;
    reservedForUserId?: string | null;
  };
}

/** ========= Admin helpers ========= */
export type AdminAccountItem = {
  id: string;
  email?: string;
  name?: string;
};

export async function adminListAccounts(): Promise<AdminAccountItem[]> {
  const res = await api.get("/api/admin/accounts-users", {
    params: {
      onlyActive: true,
      skip: 0,
      take: 500,
    },
  });

  const source = (res.data?.items ?? res.data ?? []) as unknown[];

  return (Array.isArray(source) ? source : []).map((item) => {
    const value = item as Record<string, unknown>;

    return {
      id: String(
        value.id ||
          value._id ||
          value.accountId ||
          "",
      ),
      email: value.email ? String(value.email) : undefined,
      name: value.userName
        ? String(value.userName)
        : value.name
          ? String(value.name)
          : value.fullName
            ? String(value.fullName)
            : undefined,
    };
  });
}

/**
 * Admin kích hoạt code cho một tài khoản cụ thể.
 * Dùng endpoint Admin riêng thay vì giả lập X-User-Id trên endpoint User.
 */
export async function redeemForUser(code: string, userId: string) {
  const res = await api.post(
    "/api/admin/subscriptions/redeem-for-user",
    {
      code: code.trim().toUpperCase(),
      userId: userId.trim(),
    },
  );

  return res.data as {
    message: string;
    code: string;
    userId: string;
    email?: string | null;
    plan: string;
    features: string[];
    startedAtUtc: string;
    endsAtUtc: string;
  };
}