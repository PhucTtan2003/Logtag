import api from "../api/axios";

export type ReportFormat = "csv" | "xlsx" | "pdf";
export type ReportRunStatus = "pending" | "success" | "failed" | string;

export interface MonthlyReportSchedule {
  id: string;
  userId?: string;
  userEmail?: string;
  userName?: string;
  teamId: number;
  serialNumbers: string[];
  recipients: string[];
  cc: string[];
  isEnabled: boolean;
  frequency: string;
  sendDayOfMonth: number;
  sendTimeLocal: string;
  timeZoneId: string;
  format: ReportFormat | string;
  includeSummary: boolean;
  includeRawData: boolean;
  includeAlerts: boolean;
  createdAtUtc?: string;
  updatedAtUtc?: string | null;
}

export interface MonthlyReportRun {
  id: string;
  scheduleId: string;
  userId?: string;
  userEmail?: string;
  userName?: string;
  periodKey: string;
  fromUtc: string;
  toUtc: string;
  status: ReportRunStatus;
  startedAtUtc: string;
  sentAtUtc?: string | null;
  error?: string | null;
  recipients: string[];
  attachmentNames: string[];
}

export interface SaveMonthlyReportScheduleRequest {
  teamId: number;
  serialNumbers: string[];
  recipients: string[];
  cc: string[];
  sendDayOfMonth: number;
  sendTimeLocal: string;
  timeZoneId: string;
  format: ReportFormat | string;
  isEnabled: boolean;
  includeSummary: boolean;
  includeRawData: boolean;
  includeAlerts: boolean;
}

export interface ListResponse<T> {
  total?: number;
  items: T[];
}

function unwrapList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as any).items)) {
    return (data as any).items as T[];
  }
  if (data && typeof data === "object" && Array.isArray((data as any).data)) {
    return (data as any).data as T[];
  }
  return [];
}

export const monthlyReportsApi = {
  async listMySchedules(): Promise<MonthlyReportSchedule[]> {
    const res = await api.get("/api/report-schedules");
    return unwrapList<MonthlyReportSchedule>(res.data);
  },

  async createSchedule(payload: SaveMonthlyReportScheduleRequest): Promise<MonthlyReportSchedule> {
    const res = await api.post("/api/report-schedules", payload);
    return (res.data?.item ?? res.data) as MonthlyReportSchedule;
  },

  async updateSchedule(id: string, payload: SaveMonthlyReportScheduleRequest): Promise<MonthlyReportSchedule> {
    const res = await api.put(`/api/report-schedules/${encodeURIComponent(id)}`, payload);
    return (res.data?.item ?? res.data) as MonthlyReportSchedule;
  },

  async deleteSchedule(id: string): Promise<void> {
    await api.delete(`/api/report-schedules/${encodeURIComponent(id)}`);
  },

  async sendTest(id: string): Promise<any> {
    const res = await api.post(`/api/report-schedules/${encodeURIComponent(id)}/send-test`);
    return res.data;
  },

  async listMyRuns(): Promise<MonthlyReportRun[]> {
    const res = await api.get("/api/report-schedules/runs");
    return unwrapList<MonthlyReportRun>(res.data);
  },

  async adminListSchedules(): Promise<MonthlyReportSchedule[]> {
    const res = await api.get("/api/admin/report-schedules");
    return unwrapList<MonthlyReportSchedule>(res.data);
  },

  async adminListRuns(): Promise<MonthlyReportRun[]> {
    const res = await api.get("/api/admin/report-schedules/runs");
    return unwrapList<MonthlyReportRun>(res.data);
  },

  async adminToggleSchedule(id: string, enabled: boolean): Promise<any> {
    const res = await api.patch(`/api/admin/report-schedules/${encodeURIComponent(id)}/toggle`, null, {
      params: { enabled },
    });
    return res.data;
  },

  async adminSendNow(id: string): Promise<any> {
    const res = await api.post(`/api/admin/report-schedules/${encodeURIComponent(id)}/send-now`);
    return res.data;
  },
};
