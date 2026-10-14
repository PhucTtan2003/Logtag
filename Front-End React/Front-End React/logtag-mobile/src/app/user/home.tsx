import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  Text,
  TextInput,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "../../components/api/client";
import { RealtimeChart } from "../../components/RealtimeChart";
import { styles } from "../styles/home.styles";

type DeviceStatus = "online" | "warning" | "offline";
type FilterStatus = "all" | DeviceStatus;

type DeviceItem = {
  serial: string;
  name: string;
  temperature: number | null;
  humidity: number | null;
  status: DeviceStatus;
  updatedAt: string;
  dateUtc?: string;
};

type ApiAny = Record<string, any>;

const DEVICE_ENDPOINT = "/api/mobile/v1/devices";
const OFFLINE_AFTER_MINUTES = 1440;

export default function UserHomePage() {
  const [email, setEmail] = useState("user@smarttech.com.vn");
  const [password, setPassword] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [displayName, setDisplayName] = useState("King");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState("");
  const [lastRefreshText, setLastRefreshText] = useState("");
  const [selectedSerial, setSelectedSerial] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterStatus>("all");

  const summary = useMemo(() => {
    const online = devices.filter((x) => x.status === "online").length;
    const warning = devices.filter((x) => x.status === "warning").length;
    const offline = devices.filter((x) => x.status === "offline").length;

    const temps = devices
      .map((x) => x.temperature)
      .filter((x): x is number => typeof x === "number");

    const humidities = devices
      .map((x) => x.humidity)
      .filter((x): x is number => typeof x === "number");

    return {
      total: devices.length,
      online,
      warning,
      offline,
      avgTemp:
        temps.length > 0
          ? temps.reduce((sum, item) => sum + item, 0) / temps.length
          : null,
      avgHumidity:
        humidities.length > 0
          ? humidities.reduce((sum, item) => sum + item, 0) / humidities.length
          : null,
    };
  }, [devices]);

  const selectedDevice = useMemo(() => {
    if (devices.length === 0) return null;

    return devices.find((item) => item.serial === selectedSerial) || devices[0];
  }, [devices, selectedSerial]);

  const visibleDevices = useMemo(() => {
    if (activeFilter === "all") return devices;
    return devices.filter((item) => item.status === activeFilter);
  }, [devices, activeFilter]);

  const systemState = useMemo(() => {
    if (summary.warning > 0) {
      return {
        title: `${summary.warning} thiết bị cần kiểm tra`,
        desc: "Có thiết bị đang vượt điều kiện giám sát hoặc phát sinh cảnh báo.",
        tone: "warning" as const,
        label: "Cần chú ý",
      };
    }

    if (summary.offline > 0) {
      return {
        title: `${summary.offline} thiết bị mất kết nối`,
        desc: "Một số thiết bị chưa gửi dữ liệu mới trong thời gian gần đây.",
        tone: "offline" as const,
        label: "Offline",
      };
    }

    return {
      title: "Hệ thống đang ổn định",
      desc: "Không phát hiện cảnh báo đang mở tại thời điểm hiện tại.",
      tone: "good" as const,
      label: "Ổn định",
    };
  }, [summary.warning, summary.offline]);

  const loadDevices = useCallback(async (silent = false) => {
    try {
      if (!silent) setDevicesLoading(true);
      setDevicesError("");

      const res = await api.get(DEVICE_ENDPOINT);
      const raw = normalizeArrayResponse(res.data);

      const mapped = raw
        .map(normalizeDevice)
        .filter((item): item is DeviceItem => Boolean(item));

      setDevices(mapped);

      setSelectedSerial((current) => {
        if (mapped.length === 0) return "";
        if (current && mapped.some((item) => item.serial === current)) {
          return current;
        }
        return mapped[0].serial;
      });

      setLastRefreshText(`Cập nhật lúc ${formatClock(new Date())}`);
    } catch (err: any) {
      const message =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "Không lấy được danh sách thiết bị realtime.";

      setDevicesError(message);
      console.log("LOAD DEVICES ERROR:", err?.response?.data || err?.message);
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!loggedIn) return;

    loadDevices(false);

    const timer = setInterval(() => {
      loadDevices(true);
    }, 5000);

    return () => clearInterval(timer);
  }, [loggedIn, loadDevices]);

  async function handleLogin() {
    setError("");

    const cleanEmail = email.trim();

    if (!cleanEmail || !password.trim()) {
      setError("Vui lòng nhập email và mật khẩu.");
      return;
    }

    try {
      setLoading(true);

      const res = await api.post("/api/auth/login", {
        email: cleanEmail,
        password,
        passwords: password,
      });

      const data = res.data || {};

      const nameFromApi =
        data.name ||
        data.userName ||
        data.displayName ||
        data.email?.split?.("@")?.[0] ||
        cleanEmail.split("@")[0];

      setDisplayName(nameFromApi);
      setLoggedIn(true);
      setPassword("");
    } catch (err: any) {
      const status = err?.response?.status;
      const data = err?.response?.data;

      const message =
        data?.message ||
        data?.error ||
        data?.title ||
        (status === 401
          ? "Email hoặc mật khẩu không đúng."
          : "Đăng nhập thất bại. Kiểm tra backend hoặc đường dẫn API.");

      setError(message);
      console.log("LOGIN ERROR:", data || err?.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    try {
      await api.post("/api/auth/logout");
    } catch {
      // Vẫn cho thoát UI nếu backend logout lỗi.
    }

    setLoggedIn(false);
    setPassword("");
    setError("");
    setDevices([]);
    setDevicesError("");
    setLastRefreshText("");
    setSelectedSerial("");
    setActiveFilter("all");
  }

  function showComingSoon(title: string) {
    Alert.alert(title, "Mình sẽ nối chức năng này với API ở bước tiếp theo.");
  }

  if (!loggedIn) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="dark-content" />

        <KeyboardAvoidingView
          style={styles.loginKeyboard}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.loginScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.authShell}>
              <View style={styles.authBadge}>
                <Text style={styles.authBadgeText}>LT</Text>
              </View>

              <Text style={styles.loginTitle}>LogTag Mobile</Text>

              <Text style={styles.loginSubtitle}>
                Trung tâm giám sát thiết bị, nhiệt độ, cảnh báo và dữ liệu
                realtime.
              </Text>

              <View style={styles.formCard}>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Nhập email"
                  placeholderTextColor="#94a3b8"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  returnKeyType="next"
                  style={styles.input}
                />

                <Text style={styles.label}>Mật khẩu</Text>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Nhập mật khẩu"
                  placeholderTextColor="#94a3b8"
                  secureTextEntry
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                  style={styles.input}
                />

                {error ? <Text style={styles.errorText}>{error}</Text> : null}

                <Pressable
                  style={[
                    styles.primaryButton,
                    loading && styles.primaryButtonDisabled,
                  ]}
                  onPress={handleLogin}
                  disabled={loading}
                >
                  <Text style={styles.primaryButtonText}>
                    {loading ? "Đang đăng nhập..." : "Đăng nhập"}
                  </Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.layout}>
          <View style={styles.topBar}>
            <View style={styles.topLeft}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{getInitial(displayName)}</Text>
              </View>

              <View style={styles.titleBlock}>
                <Text style={styles.overline}>SMARTTECH LOGTAG</Text>
                <Text style={styles.pageTitle}>Trang chủ giám sát</Text>
                <Text style={styles.subText}>
                  Xin chào, {displayName} •{" "}
                  {lastRefreshText || "Đang đồng bộ dữ liệu"}
                </Text>
              </View>
            </View>

            <View style={styles.topActions}>
              <Pressable
                style={styles.iconButton}
                onPress={() => loadDevices(false)}
                disabled={devicesLoading}
              >
                <Text style={styles.iconButtonText}>
                  {devicesLoading ? "..." : "⟳"}
                </Text>
              </Pressable>

              <Pressable
                style={styles.iconButton}
                onPress={() => showComingSoon("Thông báo")}
              >
                <Text style={styles.iconButtonText}>🔔</Text>
              </Pressable>

              <Pressable style={styles.logoutButton} onPress={handleLogout}>
                <Text style={styles.logoutText}>Đăng xuất</Text>
              </Pressable>
            </View>
          </View>

          <LinearGradient
            colors={
              systemState.tone === "good"
                ? ["#0f766e", "#2563eb"]
                : systemState.tone === "warning"
                ? ["#c2410c", "#7c2d12"]
                : ["#334155", "#0f172a"]
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.pulseCard}
          >
            <View style={styles.pulseHeader}>
              <View>
                <Text style={styles.pulseKicker}>TRUNG TÂM ĐIỀU KHIỂN</Text>
                <Text style={styles.pulseTitle}>{systemState.title}</Text>
                <Text style={styles.pulseSub}>{systemState.desc}</Text>
              </View>

              <View style={styles.pulseLiveBadge}>
                <Text style={styles.pulseLiveDot}>●</Text>
                <Text style={styles.pulseLiveText}>{systemState.label}</Text>
              </View>
            </View>

            <View style={styles.pulseStats}>
              <PulseMetric label="Tổng thiết bị" value={summary.total} />
              <PulseMetric label="Online" value={summary.online} />
              <PulseMetric label="Cảnh báo" value={summary.warning} />
              <PulseMetric label="Offline" value={summary.offline} />
            </View>
          </LinearGradient>

          <View style={styles.actionGrid}>
            <ActionCard
              icon="📡"
              title="Thiết bị"
              desc="Xem toàn bộ thiết bị đang được gán cho tài khoản."
              onPress={() => setActiveFilter("all")}
            />

            <ActionCard
              icon="🚨"
              title="Cảnh báo"
              desc="Lọc nhanh thiết bị cảnh báo hoặc cần kiểm tra."
              onPress={() => setActiveFilter("warning")}
            />

            <ActionCard
              icon="📲"
              title="SMS"
              desc="Quản lý nhận cảnh báo qua tin nhắn SMS."
              onPress={() => showComingSoon("SMS cảnh báo")}
            />

            <ActionCard
              icon="🌡️"
              title="Ngưỡng"
              desc="Cài đặt ngưỡng nhiệt độ cho thiết bị."
              onPress={() => showComingSoon("Cài ngưỡng")}
            />
          </View>

          <View style={styles.sectionRow}>
            <View>
              <Text style={styles.sectionTitle}>Realtime Monitor</Text>
              <Text style={styles.sectionSub}>
                Chọn thiết bị để xem biểu đồ nhiệt độ theo thời gian thực
              </Text>
            </View>

            <Text style={styles.sectionRight}>
              {summary.avgTemp === null ? "--" : `${summary.avgTemp.toFixed(1)}°C TB`}
            </Text>
          </View>

          <View style={styles.livePanel}>
            {selectedDevice ? (
              <>
                <View style={styles.liveHeader}>
                  <View>
                    <Text style={styles.liveTitle}>{selectedDevice.name}</Text>
                    <Text style={styles.liveSerial}>
                      {selectedDevice.serial}
                    </Text>
                  </View>

                  <StatusBadge status={selectedDevice.status} />
                </View>

                <View style={styles.selectedMetrics}>
                  <MiniMetric
                    label="Nhiệt độ"
                    value={`${formatNumber(selectedDevice.temperature)}°C`}
                  />
                  <MiniMetric
                    label="Độ ẩm"
                    value={`${formatNumber(selectedDevice.humidity)}%`}
                  />
                  <MiniMetric
                    label="Cập nhật"
                    value={selectedDevice.updatedAt}
                    small
                  />
                </View>

                <RealtimeChart
                  serial={selectedDevice.serial}
                  minutes={60}
                  refreshMs={5000}
                />
              </>
            ) : (
              <EmptyState />
            )}
          </View>

          <View style={styles.devicesStrip}>
            <FilterPill
              label="Tất cả"
              active={activeFilter === "all"}
              onPress={() => setActiveFilter("all")}
            />
            <FilterPill
              label="Online"
              active={activeFilter === "online"}
              onPress={() => setActiveFilter("online")}
            />
            <FilterPill
              label="Cảnh báo"
              active={activeFilter === "warning"}
              onPress={() => setActiveFilter("warning")}
            />
            <FilterPill
              label="Offline"
              active={activeFilter === "offline"}
              onPress={() => setActiveFilter("offline")}
            />
          </View>

          <View style={styles.sectionRow}>
            <View>
              <Text style={styles.sectionTitle}>Thiết bị của bạn</Text>
              <Text style={styles.sectionSub}>
                {visibleDevices.length} thiết bị đang hiển thị
              </Text>
            </View>

            <Text style={styles.sectionRight}>Realtime</Text>
          </View>

          {devicesError ? (
            <Text style={styles.errorText}>{devicesError}</Text>
          ) : null}

          {devicesLoading && devices.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Đang tải thiết bị...</Text>
              <Text style={styles.emptyDesc}>
                App đang lấy dữ liệu realtime từ backend.
              </Text>
            </View>
          ) : null}

          {!devicesLoading && devices.length === 0 && !devicesError ? (
            <EmptyState />
          ) : null}

          <View style={styles.deviceList}>
            {visibleDevices.map((device) => (
              <DeviceRow
                key={device.serial}
                device={device}
                selected={selectedDevice?.serial === device.serial}
                onPress={() => setSelectedSerial(device.serial)}
              />
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function PulseMetric({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.pulseMetric}>
      <Text style={styles.pulseMetricValue}>{value}</Text>
      <Text style={styles.pulseMetricLabel}>{label}</Text>
    </View>
  );
}

function ActionCard({
  icon,
  title,
  desc,
  onPress,
}: {
  icon: string;
  title: string;
  desc: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.actionCard} onPress={onPress}>
      <Text style={styles.actionIcon}>{icon}</Text>

      <View style={styles.actionTextBox}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionDesc}>{desc}</Text>
      </View>
    </Pressable>
  );
}

function MiniMetric({
  label,
  value,
  small,
}: {
  label: string;
  value: string;
  small?: boolean;
}) {
  return (
    <View style={styles.miniMetric}>
      <Text style={styles.miniMetricLabel}>{label}</Text>
      <Text
        style={[
          styles.miniMetricValue,
          small && styles.miniMetricValueSmall,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function FilterPill({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.filterPill, active && styles.filterPillActive]}
      onPress={onPress}
    >
      <Text
        style={[
          styles.filterPillText,
          active && styles.filterPillTextActive,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function DeviceRow({
  device,
  selected,
  onPress,
}: {
  device: DeviceItem;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.deviceCard, selected && styles.deviceCardSelected]}
      onPress={onPress}
    >
      <View style={styles.deviceCardTop}>
        <View style={styles.deviceInfo}>
          <Text style={styles.deviceName}>{device.name}</Text>
          <Text style={styles.deviceSerial}>{device.serial}</Text>
        </View>

        <StatusBadge status={device.status} />
      </View>

      <View style={styles.deviceMetrics}>
        <View style={styles.smallMetric}>
          <Text style={styles.smallLabel}>Nhiệt độ</Text>
          <Text style={styles.smallValue}>
            {formatNumber(device.temperature)}°C
          </Text>
        </View>

        <View style={styles.smallMetric}>
          <Text style={styles.smallLabel}>Độ ẩm</Text>
          <Text style={styles.smallValue}>
            {formatNumber(device.humidity)}%
          </Text>
        </View>
      </View>

      <Text style={styles.updatedText}>{device.updatedAt}</Text>

      <Text style={styles.hintText}>
        {selected ? "Đang hiển thị trên monitor" : "Bấm để xem realtime"}
      </Text>
    </Pressable>
  );
}

function StatusBadge({ status }: { status: DeviceStatus }) {
  const label =
    status === "online"
      ? "Online"
      : status === "warning"
      ? "Cảnh báo"
      : "Offline";

  const style =
    status === "online"
      ? styles.statusOnline
      : status === "warning"
      ? styles.statusWarning
      : styles.statusOffline;

  return (
    <View style={[styles.statusBadge, style]}>
      <Text style={styles.statusText}>{label}</Text>
    </View>
  );
}

function EmptyState() {
  return (
    <View style={styles.emptyCard}>
      <Text style={styles.emptyTitle}>Chưa có thiết bị</Text>
      <Text style={styles.emptyDesc}>
        Tài khoản này chưa được gán thiết bị hoặc backend chưa trả dữ liệu.
      </Text>
    </View>
  );
}

function normalizeArrayResponse(data: any): ApiAny[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.devices)) return data.devices;
  if (Array.isArray(data?.result)) return data.result;
  return [];
}

function normalizeDevice(row: ApiAny): DeviceItem | null {
  const latest = row.latest || row.latestReading || row.reading || row.last || row;

  const serial =
    row.serialNumber ||
    row.serial ||
    row.SerialNumber ||
    row.device?.serialNumber ||
    row.device?.serial ||
    latest.serialNumber ||
    latest.serial;

  if (!serial) return null;

  const temperature = toNumber(
    latest.temperature ??
      latest.Temperature ??
      row.temperature ??
      row.currentTemperature
  );

  const humidity = toNumber(
    latest.humidity ?? latest.Humidity ?? row.humidity ?? row.currentHumidity
  );

  const dateUtc =
    latest.dateUtc ||
    latest.DateUtc ||
    latest.createdAtUtc ||
    latest.timestampUtc ||
    row.dateUtc ||
    row.updatedAtUtc ||
    row.lastSeenUtc;

  const status = normalizeStatus(row, temperature, dateUtc);

  const name =
    row.name ||
    row.deviceName ||
    row.displayName ||
    row.notes ||
    row.device?.name ||
    row.device?.model ||
    serial;

  return {
    serial: String(serial).trim(),
    name: String(name),
    temperature,
    humidity,
    status,
    updatedAt: formatUpdatedAt(dateUtc),
    dateUtc,
  };
}

function normalizeStatus(
  row: ApiAny,
  temperature: number | null,
  dateUtc?: string
): DeviceStatus {
  const rawStatus = String(row.status || row.state || "").toLowerCase();

  if (rawStatus.includes("warning") || rawStatus.includes("alarm")) {
    return "warning";
  }

  const lower = toNumber(row.lowerThreshold ?? row.minTemp ?? row.min);
  const upper = toNumber(row.upperThreshold ?? row.maxTemp ?? row.max);

  if (
    temperature !== null &&
    ((lower !== null && temperature < lower) ||
      (upper !== null && temperature > upper))
  ) {
    return "warning";
  }

  if (dateUtc) {
    const t = new Date(dateUtc).getTime();

    if (!Number.isNaN(t)) {
      const diffMinutes = (Date.now() - t) / 1000 / 60;
      if (diffMinutes > OFFLINE_AFTER_MINUTES) return "offline";
      return "online";
    }
  }

  return "offline";
}

function toNumber(value: any): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatNumber(value: number | null) {
  if (value === null || Number.isNaN(value)) return "--";
  return value.toFixed(1);
}

function formatClock(date: Date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(
    date.getSeconds()
  )}`;
}

function formatUpdatedAt(value?: string) {
  if (!value) return "Chưa có thời gian cập nhật";

  const time = new Date(value).getTime();

  if (Number.isNaN(time)) return String(value);

  const diffSeconds = Math.max(0, Math.floor((Date.now() - time) / 1000));

  if (diffSeconds < 10) return "Vừa cập nhật";
  if (diffSeconds < 60) return `${diffSeconds} giây trước`;

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} phút trước`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} giờ trước`;

  const d = new Date(time);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}`;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function getInitial(name: string) {
  return (name || "U").trim().slice(0, 1).toUpperCase();
}