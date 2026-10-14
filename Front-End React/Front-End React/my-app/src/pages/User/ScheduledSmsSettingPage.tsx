import React, { useEffect, useMemo, useState } from "react";
import api from "../../api/axios";
import "../../styles/User/ScheduledSmsSettingsPage.css";

type SmsScheduleConfig = {
  id: string;
  userId: string;
  username?: string | null;
  serialNumber: string;
  scheduleTimes: string[];
  enabled: boolean;
  maxTimesPerDevice?: number;
  maxChangesPerDay?: number;
  changeCountToday?: number;
  remainingChanges?: number;
  lastChangedLocalDate?: string | null;
  lastChangedAtUtc?: string | null;
  createdAtUtc?: string | null;
  updatedAtUtc?: string | null;
};

type ApiListResponse = {
  ok?: boolean;
  locked?: boolean;
  feature?: string;
  message?: string;
  maxTimesPerDevice?: number;
  maxChangesPerDay?: number;
  items: SmsScheduleConfig[];
};

type ApiSaveResponse = {
  ok: boolean;
  locked?: boolean;
  feature?: string;
  message?: string;
  maxTimesPerDevice?: number;
  maxChangesPerDay?: number;
  remainingChanges?: number;
  config?: SmsScheduleConfig | null;
};

const DEFAULT_MAX_TIMES = 2;

const QUICK_TIMES = ["07:00", "08:00", "09:00", "12:00", "15:00", "18:00", "21:00"];

const isHHmm = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

const todayVietnam = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const formatDateTime = (iso?: string | null) => {
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

const sortTimes = (times: string[]) =>
  Array.from(new Set(times.filter(isHHmm))).sort((a, b) => a.localeCompare(b));

const getApiErrorText = (err: any, fallback: string) => {
  const status = err?.response?.status;
  const apiMsg = err?.response?.data?.message;
  const detail = err?.response?.data?.detail;
  const error = err?.response?.data?.error;

  if (apiMsg) return apiMsg;
  if (detail) return detail;
  if (error) return error;

  if (status === 401) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
  if (status === 403) return "Bạn chưa được kích hoạt dịch vụ SMS định kỳ hoặc gói đã hết hạn.";
  if (status === 404) return "Không tìm thấy API SMS định kỳ. Kiểm tra backend đã deploy SmsScheduleController chưa.";

  if (err instanceof Error && err.message) return err.message;

  return fallback;
};

const ScheduledSmsSettingsPage: React.FC = () => {
  const [configs, setConfigs] = useState<SmsScheduleConfig[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [serialNumber, setSerialNumber] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [scheduleTimes, setScheduleTimes] = useState<string[]>([]);
  const [timeInput, setTimeInput] = useState("09:00");

  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [locked, setLocked] = useState(false);

  const [maxTimes, setMaxTimes] = useState(DEFAULT_MAX_TIMES);
  const [maxChangesPerDay, setMaxChangesPerDay] = useState(3);

  const [message, setMessage] = useState<{
    type: "ok" | "error" | "info";
    text: string;
  } | null>(null);

  const selectedConfig = useMemo(
    () => configs.find((x) => x.id === selectedId) || null,
    [configs, selectedId]
  );

  const vnToday = useMemo(() => todayVietnam(), []);
  const changedToday = selectedConfig?.lastChangedLocalDate === vnToday;

  const filteredConfigs = useMemo(() => {
    const key = search.trim().toLowerCase();

    if (!key) return configs;

    return configs.filter((cfg) => {
      const serial = cfg.serialNumber?.toLowerCase() || "";
      const times = (cfg.scheduleTimes || []).join(" ").toLowerCase();
      return serial.includes(key) || times.includes(key);
    });
  }, [configs, search]);

  const stats = useMemo(() => {
    const total = configs.length;
    const active = configs.filter((x) => x.enabled).length;
    const disabled = total - active;
    const totalTimes = configs.reduce((sum, x) => sum + (x.scheduleTimes?.length || 0), 0);

    return { total, active, disabled, totalTimes };
  }, [configs]);

  const fillForm = (cfg: SmsScheduleConfig) => {
    setSelectedId(cfg.id);
    setSerialNumber(cfg.serialNumber || "");
    setEnabled(!!cfg.enabled);
    setScheduleTimes(sortTimes(cfg.scheduleTimes || []));
    setTimeInput("09:00");
    setMessage(null);
  };

  const resetForm = (showMessage = true) => {
    setSelectedId(null);
    setSerialNumber("");
    setEnabled(true);
    setScheduleTimes([]);
    setTimeInput("09:00");

    if (showMessage) {
      setMessage({
        type: "info",
        text: "Bạn đang tạo lịch SMS định kỳ mới.",
      });
    }
  };

  const loadConfigs = async (preferredId?: string | null) => {
    setLoading(true);
    setMessage(null);

    try {
      const res = await api.get<ApiListResponse>("/api/sms-schedule/my");
      const data = res.data;
      const items = Array.isArray(data.items) ? data.items : [];

      setLocked(!!data.locked);
      setMaxTimes(data.maxTimesPerDevice || DEFAULT_MAX_TIMES);
      setMaxChangesPerDay(data.maxChangesPerDay || 3);
      setConfigs(items);

      if (items.length === 0) {
        resetForm(false);
        return;
      }

      const target =
        items.find((x) => x.id === preferredId) ||
        items.find((x) => x.id === selectedId) ||
        items[0];

      fillForm(target);
    } catch (err: any) {
      const status = err?.response?.status;
      const data = err?.response?.data;

      if (status === 403 && data?.locked) {
        setLocked(true);
        setConfigs([]);
        resetForm(false);
      }

      setMessage({
        type: "error",
        text: getApiErrorText(err, "Không tải được cấu hình SMS định kỳ."),
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConfigs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addTimeValue = (value: string) => {
    const t = value.trim();

    if (locked) {
      setMessage({
        type: "error",
        text: "Bạn chưa được kích hoạt dịch vụ SMS định kỳ hoặc gói đã hết hạn.",
      });
      return;
    }

    if (!isHHmm(t)) {
      setMessage({
        type: "error",
        text: "Giờ không hợp lệ. Vui lòng dùng định dạng HH:mm, ví dụ 09:00.",
      });
      return;
    }

    if (scheduleTimes.includes(t)) {
      setMessage({
        type: "info",
        text: "Khung giờ này đã có trong danh sách.",
      });
      return;
    }

    if (scheduleTimes.length >= maxTimes) {
      setMessage({
        type: "error",
        text: `Tối đa ${maxTimes} khung giờ mỗi ngày.`,
      });
      return;
    }

    setScheduleTimes((prev) => sortTimes([...prev, t]));
    setMessage(null);
  };

  const addTime = () => addTimeValue(timeInput);

  const removeTime = (t: string) => {
    setScheduleTimes((prev) => prev.filter((x) => x !== t));
  };

  const save = async () => {
    const serial = serialNumber.trim().toUpperCase();

    if (locked) {
      setMessage({
        type: "error",
        text: "Bạn chưa được kích hoạt dịch vụ SMS định kỳ hoặc gói đã hết hạn.",
      });
      return;
    }

    if (!serial) {
      setMessage({
        type: "error",
        text: "Vui lòng nhập Serial thiết bị.",
      });
      return;
    }

    if (enabled && scheduleTimes.length === 0) {
      setMessage({
        type: "error",
        text: "Vui lòng thêm ít nhất 1 khung giờ gửi SMS.",
      });
      return;
    }

    if (scheduleTimes.length > maxTimes) {
      setMessage({
        type: "error",
        text: `Mỗi thiết bị/kênh chỉ được cài tối đa ${maxTimes} khung giờ SMS.`,
      });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const res = await api.post<ApiSaveResponse>("/api/sms-schedule/update", {
        serialNumber: serial,
        times: sortTimes(scheduleTimes),
        enabled,
      });

      const data = res.data;

      if (data?.ok === false) {
        throw new Error(data?.message || "Lưu thất bại.");
      }

      if (typeof data?.maxTimesPerDevice === "number") {
        setMaxTimes(data.maxTimesPerDevice);
      }

      if (typeof data?.maxChangesPerDay === "number") {
        setMaxChangesPerDay(data.maxChangesPerDay);
      }

      setLocked(!!data?.locked);
      setMessage({
        type: "ok",
        text: data?.message || "Đã lưu khung giờ SMS.",
      });

      await loadConfigs(data?.config?.id || selectedId);
    } catch (err: any) {
      const status = err?.response?.status;
      const data = err?.response?.data;

      if (status === 403 && data?.locked) {
        setLocked(true);
      }

      setMessage({
        type: "error",
        text: getApiErrorText(err, "Lưu cấu hình SMS thất bại."),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="scheduled-sms">
      <div className="scheduled-sms__hero">
        <div className="scheduled-sms__hero-content">
          <div className="scheduled-sms__badge">
            <span className="scheduled-sms__badge-dot" />
            SMS định kỳ
          </div>

          <h2>Gửi nhiệt độ gần nhất theo khung giờ</h2>

          <p>
            Người dùng tự chọn giờ nhận SMS. Hệ thống sẽ xếp lịch và gửi theo hàng đợi,
            hạn chế tình trạng nhiều SMS bị dồn vào cùng một thời điểm.
          </p>
        </div>

        <div className="scheduled-sms__hero-actions">
          <button
            className="scheduled-sms__btn scheduled-sms__btn--soft"
            type="button"
            onClick={() => void loadConfigs()}
            disabled={loading}
          >
            {loading ? "Đang tải..." : "Tải lại"}
          </button>

          <button
            className="scheduled-sms__btn scheduled-sms__btn--primary"
            type="button"
            onClick={() => resetForm(true)}
            disabled={locked}
          >
            + Tạo lịch mới
          </button>
        </div>
      </div>

      {locked && (
        <div className="scheduled-sms__notice scheduled-sms__notice--error">
          Dịch vụ SMS định kỳ chưa được kích hoạt hoặc đã hết hạn. Vui lòng dùng mã có
          feature <b>sms_schedule</b> để mở chức năng này.
        </div>
      )}

      <div className="scheduled-sms__stats">
        <div className="scheduled-sms__stat-card">
          <span>Tổng lịch</span>
          <strong>{stats.total}</strong>
        </div>

        <div className="scheduled-sms__stat-card">
          <span>Đang bật</span>
          <strong>{stats.active}</strong>
        </div>

        <div className="scheduled-sms__stat-card">
          <span>Đã tắt</span>
          <strong>{stats.disabled}</strong>
        </div>

        <div className="scheduled-sms__stat-card">
          <span>Tổng khung giờ</span>
          <strong>{stats.totalTimes}</strong>
        </div>
      </div>

      <div className="scheduled-sms__grid">
        <aside className="scheduled-sms__sidebar">
          <div className="scheduled-sms__panel-head">
            <div>
              <h3>Lịch đã cài</h3>
              <p>Chọn một thiết bị để chỉnh sửa.</p>
            </div>
          </div>

          <div className="scheduled-sms__search">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm serial hoặc giờ..."
              disabled={locked}
            />
          </div>

          {loading ? (
            <div className="scheduled-sms__empty">
              <div className="scheduled-sms__empty-icon">⏳</div>
              <strong>Đang tải dữ liệu</strong>
              <span>Vui lòng chờ trong giây lát.</span>
            </div>
          ) : filteredConfigs.length === 0 ? (
            <div className="scheduled-sms__empty">
              <div className="scheduled-sms__empty-icon">📭</div>
              <strong>Chưa có lịch phù hợp</strong>
              <span>{locked ? "Chức năng đang bị khóa." : "Tạo lịch mới hoặc đổi từ khóa tìm kiếm."}</span>
            </div>
          ) : (
            <div className="scheduled-sms__list">
              {filteredConfigs.map((cfg) => {
                const times = sortTimes(cfg.scheduleTimes || []);

                return (
                  <button
                    key={cfg.id}
                    className={`scheduled-sms__item ${cfg.id === selectedId ? "is-active" : ""}`}
                    type="button"
                    onClick={() => fillForm(cfg)}
                  >
                    <div className="scheduled-sms__item-top">
                      <span className="scheduled-sms__serial">{cfg.serialNumber}</span>
                      <span className={`scheduled-sms__status ${cfg.enabled ? "is-on" : "is-off"}`}>
                        {cfg.enabled ? "Bật" : "Tắt"}
                      </span>
                    </div>

                    <div className="scheduled-sms__item-times">
                      {times.length > 0 ? times.join(" · ") : "Chưa cài giờ"}
                    </div>

                    <div className="scheduled-sms__item-foot">
                      <span>{times.length} khung giờ/ngày</span>
                      <span>Cập nhật: {formatDateTime(cfg.updatedAtUtc)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <main className="scheduled-sms__form-card">
          <div className="scheduled-sms__form-top">
            <div>
              <span className="scheduled-sms__section-label">
                {selectedConfig ? "Chỉnh sửa cấu hình" : "Cấu hình mới"}
              </span>
            </div>

            <label className="scheduled-sms__switch">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                disabled={locked}
              />
              <span className="scheduled-sms__switch-ui" />
              <b>{enabled ? "Đang bật" : "Đang tắt"}</b>
            </label>
          </div>

          {changedToday && (
            <div className="scheduled-sms__notice scheduled-sms__notice--warn">
              Hôm nay lịch này đã được thay đổi. Theo rule hệ thống, user chỉ được đổi
              khung giờ {maxChangesPerDay} lần/ngày.
            </div>
          )}

          <div className="scheduled-sms__form-section">
            <label className="scheduled-sms__field">
              <span>Serial thiết bị</span>
              <input
                value={serialNumber}
                onChange={(e) => setSerialNumber(e.target.value.toUpperCase())}
                placeholder="Ví dụ: ABC123"
                disabled={locked}
              />
              <small>Nhập đúng serial của thiết bị cần nhận SMS định kỳ.</small>
            </label>
          </div>

          <div className="scheduled-sms__form-section">
            <div className="scheduled-sms__section-title">
              <div>
                <h4>Khung giờ gửi SMS</h4>
                <p>Tối đa {maxTimes} khung giờ mỗi ngày.</p>
              </div>

              <span className="scheduled-sms__counter">
                {scheduleTimes.length}/{maxTimes}
              </span>
            </div>

            <div className="scheduled-sms__quick-times">
              {QUICK_TIMES.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={scheduleTimes.includes(t) ? "is-selected" : ""}
                  onClick={() => addTimeValue(t)}
                  disabled={locked || scheduleTimes.includes(t) || scheduleTimes.length >= maxTimes}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="scheduled-sms__time-row">
              <label className="scheduled-sms__field">
                <span>Thêm giờ thủ công</span>
                <input
                  type="time"
                  value={timeInput}
                  onChange={(e) => setTimeInput(e.target.value)}
                  disabled={locked}
                />
              </label>

              <button
                className="scheduled-sms__btn scheduled-sms__btn--dark"
                type="button"
                onClick={addTime}
                disabled={locked}
              >
                + Thêm giờ
              </button>
            </div>

            <div className="scheduled-sms__chips">
              {scheduleTimes.length === 0 ? (
                <span className="scheduled-sms__hint">Chưa chọn khung giờ nào.</span>
              ) : (
                scheduleTimes.map((t) => (
                  <span className="scheduled-sms__chip" key={t}>
                    {t}
                    <button
                      type="button"
                      onClick={() => removeTime(t)}
                      aria-label={`Xóa ${t}`}
                      disabled={locked}
                    >
                      ×
                    </button>
                  </span>
                ))
              )}
            </div>
          </div>

          <div className="scheduled-sms__summary">
            <div>
              <span>Trạng thái gửi</span>
              <strong>{enabled ? "Đang hoạt động" : "Tạm tắt"}</strong>
            </div>

            <div>
              <span>Số lần gửi/ngày</span>
              <strong>{enabled ? `${scheduleTimes.length} lần` : "0 lần"}</strong>
            </div>

            <div>
              <span>Lần đổi gần nhất</span>
              <strong>{formatDateTime(selectedConfig?.lastChangedAtUtc)}</strong>
            </div>

            <div>
              <span>Cập nhật gần nhất</span>
              <strong>{formatDateTime(selectedConfig?.updatedAtUtc)}</strong>
            </div>
          </div>

          {message && (
            <div className={`scheduled-sms__notice scheduled-sms__notice--${message.type}`}>
              {message.text}
            </div>
          )}

          <div className="scheduled-sms__actions">
            <button
              className="scheduled-sms__btn scheduled-sms__btn--soft"
              type="button"
              onClick={() => resetForm(true)}
              disabled={locked}
            >
              Làm mới form
            </button>

            <button
              className="scheduled-sms__btn scheduled-sms__btn--primary"
              type="button"
              onClick={save}
              disabled={saving || locked}
            >
              {saving ? "Đang lưu..." : "Lưu khung giờ SMS"}
            </button>
          </div>
        </main>
      </div>
    </section>
  );
};

export default ScheduledSmsSettingsPage;
