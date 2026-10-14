import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  Brush,
} from "recharts";

interface ParameterData {
  label?: string;
  temperature?: number | null;

  // Giữ optional để data cũ / ChartBox truyền vào không lỗi,
  // nhưng chart này KHÔNG hiển thị độ ẩm nữa.
  humidity?: number | null;

  time?: string | number | Date;

  _x?: number;
  _label?: string;
  _fullLabel?: string;
  tempLine?: number | null;
  tempBase?: number | null;
  tempOk?: number | null;
  tempAlarm?: number | null;
  tempHover?: number | null;
  isTempAlarm?: boolean;
  [key: string]: any;
  isBoundary?: boolean;
}

interface Props {
  data: ParameterData[];
  tempThresholds?: { min?: number | null; max?: number | null };

  // Giữ prop này để nơi khác còn truyền cũng không lỗi.
  humThresholds?: { min?: number | null; max?: number | null };

  showBrush?: boolean;
  isFullscreen?: boolean;
  height?: number | string;
}

const TEMP_OK_COLOR = "#16a34a";
const TEMP_ALARM_COLOR = "#ef4444";

const TEMP_SOFT_GREEN = "rgba(22, 163, 74, 0.09)";
const TEMP_SOFT_RED = "rgba(239, 68, 68, 0.10)";

function toNumber(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round1(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return Math.round(n * 10) / 10;
}

function getTimeMs(v: any): number | null {
  if (v == null) return null;

  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isNaN(t) ? null : t;
  }

  if (typeof v === "number") {
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? null : t;
  }

  if (typeof v === "string") {
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? null : t;
  }

  return null;
}

function formatTimeShort(v: any, longMode = false) {
  const t = getTimeMs(v);
  if (t == null) {
    const s = String(v ?? "");
    const m = s.match(/(\d{1,2}:\d{2})(?::\d{2})?/);
    return m?.[1] ?? (s.length > 12 ? s.slice(0, 12) + "…" : s);
  }

  const d = new Date(t);

  if (longMode) {
    return d.toLocaleString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  return d.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatTimeFull(v: any) {
  const t = getTimeMs(v);
  if (t == null) return String(v ?? "");

  return new Date(t).toLocaleString("vi-VN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function buildEvenTicks(length: number, maxTicks: number) {
  if (length <= 0) return [];
  if (length === 1) return [0];

  const count = Math.min(maxTicks, length);
  const last = length - 1;

  const ticks = Array.from({ length: count }, (_, i) => {
    return Math.round((i * last) / (count - 1));
  });

  return Array.from(new Set(ticks));
}

function useContainerWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(0);

  useEffect(() => {
    if (!ref.current) return;

    const el = ref.current;

    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width ?? 0;
      setW(width);
    });

    ro.observe(el);
    setW(el.getBoundingClientRect().width);

    return () => ro.disconnect();
  }, []);

  return { ref, w };
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload || payload.length === 0) return null;

  const row = payload?.[0]?.payload as ParameterData | undefined;
  if (!row) return null;

  const tempItem =
    payload.find((p: any) => p.dataKey === "tempHover" || p.dataKey === "tempAlarm" || p.dataKey === "tempBase" || p.dataKey === "tempOk") || payload[0];

  if (!tempItem) return null;

  const isAlarm = !!row.isTempAlarm;

  return (
    <div
      style={{
        minWidth: 190,
        background:
          "linear-gradient(135deg, rgba(255,255,255,0.98), rgba(248,250,252,0.96))",
        border: "1px solid rgba(148,163,184,0.32)",
        borderRadius: 18,
        padding: "12px 14px",
        boxShadow: "0 18px 45px rgba(15,23,42,0.16)",
        backdropFilter: "blur(14px)",
      }}
    >
      <div
        style={{
          fontSize: 12,
          color: "#64748b",
          fontWeight: 800,
          marginBottom: 8,
        }}
      >
        {row._fullLabel || row._label || row.label}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 14,
            display: "grid",
            placeItems: "center",
            background: isAlarm
              ? "rgba(239,68,68,0.12)"
              : "rgba(22,163,74,0.12)",
            color: isAlarm ? TEMP_ALARM_COLOR : TEMP_OK_COLOR,
            fontSize: 18,
          }}
        >
          🌡
        </div>

        <div>
          <div
            style={{
              color: isAlarm ? TEMP_ALARM_COLOR : TEMP_OK_COLOR,
              fontSize: 22,
              fontWeight: 950,
              lineHeight: 1,
            }}
          >
            {round1(row.temperature)}°C
          </div>

          <div
            style={{
              color: "#475569",
              fontSize: 12,
              fontWeight: 800,
              marginTop: 4,
            }}
          >
            {isAlarm ? "Nhiệt độ cảnh báo" : "Nhiệt độ"}
          </div>
        </div>
      </div>
    </div>
  );
};


function tempIsAlarm(
  temp: number,
  tempMinOk: boolean,
  tMin: any,
  tempMaxOk: boolean,
  tMax: any
) {
  return (
    (tempMinOk && temp < Number(tMin)) ||
    (tempMaxOk && temp > Number(tMax))
  );
}

function crossedThresholds(
  a: number,
  b: number,
  tempMinOk: boolean,
  tMin: any,
  tempMaxOk: boolean,
  tMax: any
) {
  const arr: { threshold: number; ratio: number }[] = [];

  const add = (threshold: number) => {
    if (!Number.isFinite(threshold)) return;
    if (a === b) return;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (threshold <= lo || threshold >= hi) return;
    const ratio = (threshold - a) / (b - a);
    if (ratio > 0 && ratio < 1) arr.push({ threshold, ratio });
  };

  if (tempMinOk) add(Number(tMin));
  if (tempMaxOk) add(Number(tMax));

  arr.sort((x, y) => x.ratio - y.ratio);
  return arr;
}

export default function Chart({
  data,
  tempThresholds,
  showBrush,
  isFullscreen,
  height,
}: Props) {
  const { ref: outerRef, w: containerW } = useContainerWidth();

  const len = data?.length ?? 0;
  const isCompact = containerW < 640 || !!isFullscreen;
  const isDense = len > 160;

  const resolvedHeight = isFullscreen ? (height ?? "100%") : (height ?? 520);
  const chartHeaderHeight = isFullscreen ? 42 : 40;

  const tMin = tempThresholds?.min;
  const tMax = tempThresholds?.max;

  const tempMinOk = tMin != null && Number.isFinite(Number(tMin));
  const tempMaxOk = tMax != null && Number.isFinite(Number(tMax));

  const timeSpanMs = useMemo(() => {
    if (!data?.length) return 0;

    const times = data
      .map((d) => getTimeMs(d.time))
      .filter((x): x is number => x != null);

    if (times.length < 2) return 0;

    return Math.max(...times) - Math.min(...times);
  }, [data]);

  const longTimeMode = timeSpanMs > 24 * 60 * 60 * 1000;

  const chartData = useMemo<ParameterData[]>(() => {
    if (!data?.length) return [];

    const base = data.map((d, index) => {
      const temp = toNumber(d.temperature, 0);
      const alarm = tempIsAlarm(temp, tempMinOk, tMin, tempMaxOk, tMax);
      const labelSource = d.time ?? d.label ?? index + 1;

      return {
        ...d,
        temperature: temp,
        _x: index,
        _label: formatTimeShort(labelSource, longTimeMode),
        _fullLabel: formatTimeFull(labelSource),
        tempLine: temp,
        tempBase: temp,
        tempOk: alarm ? null : temp,
        tempAlarm: alarm ? temp : null,
        isTempAlarm: alarm,
        isBoundary: false,
      } as ParameterData;
    });

    const out: ParameterData[] = [];

    for (let i = 0; i < base.length; i++) {
      const cur = base[i];
      out.push(cur);

      const next = base[i + 1];
      if (!next) continue;

      const a = toNumber(cur.temperature, 0);
      const b = toNumber(next.temperature, 0);
      const crossings = crossedThresholds(a, b, tempMinOk, tMin, tempMaxOk, tMax);

      for (const c of crossings) {
        const x = i + c.ratio;
        out.push({
          label: cur.label,
          time: cur.time,
          temperature: c.threshold,
          _x: x,
          _label: "",
          _fullLabel: `${cur._fullLabel ?? cur.label ?? ""} → ${next._fullLabel ?? next.label ?? ""}`,
          tempLine: c.threshold,
          tempBase: c.threshold,
          // Boundary có cả 2 giá trị để 2 màu chạm nhau đúng tại đường ngưỡng,
          // không bị hở đoạn và không đè cả một đoạn dài.
          tempOk: c.threshold,
          tempAlarm: c.threshold,
          isTempAlarm: false,
          isBoundary: true,
        });
      }
    }

    return out.sort((a, b) => toNumber(a._x, 0) - toNumber(b._x, 0));
  }, [data, longTimeMode, tempMaxOk, tempMinOk, tMax, tMin]);

  const renderData = useMemo<ParameterData[]>(() => {
    return chartData.map((p) => ({
      ...p,
      // Chỉ dùng cho hover/tooltip, không vẽ chấm tĩnh. Boundary để null để không hover vào điểm giả.
      tempHover: p.isBoundary ? null : p.temperature ?? null,
    }));
  }, [chartData]);

  const tempDomain = useMemo<[number, number]>(() => {
    if (!chartData.length) return [0, 1];

    const vals = chartData
      .map((d) => toNumber(d.temperature, NaN))
      .filter(Number.isFinite);

    if (tempMinOk) vals.push(Number(tMin));
    if (tempMaxOk) vals.push(Number(tMax));

    if (!vals.length) return [0, 1];

    const min = Math.min(...vals);
    const max = Math.max(...vals);

    const range = Math.max(0.4, max - min);
    const pad = Math.max(0.45, range * 0.32);

    return [Number((min - pad).toFixed(2)), Number((max + pad).toFixed(2))];
  }, [chartData, tempMaxOk, tempMinOk, tMax, tMin]);

  const tickCount = isFullscreen ? 8 : isCompact ? 5 : 7;

  const xTicks = useMemo(() => {
    return buildEvenTicks(len, tickCount);
  }, [len, tickCount]);

  const xTickFormatter = (v: any) => {
    const x = Number(v);
    const row =
      chartData.find((d) => !d.isBoundary && Math.abs(toNumber(d._x, -999999) - x) < 0.0001) ??
      chartData.find((d) => !d.isBoundary && Math.round(toNumber(d._x, 0)) === Math.round(x));
    return row?._label ?? "";
  };

  const latestTemp = chartData.length
    ? chartData[chartData.length - 1].temperature
    : null;

  const latestAlarm = chartData.length
    ? !!chartData[chartData.length - 1].isTempAlarm
    : false;

  const minTemp = chartData.length
    ? Math.min(...chartData.map((d) => toNumber(d.temperature, 0)))
    : null;

  const maxTemp = chartData.length
    ? Math.max(...chartData.map((d) => toNumber(d.temperature, 0)))
    : null;

  const effectiveBrush = !!showBrush && len > 60;
  const animate = !isFullscreen && !isDense && len < 900;

  const renderActiveDot = (props: any) => {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null) return null;
    const alarm = !!payload?.isTempAlarm;

    return (
      <circle
        cx={cx}
        cy={cy}
        r={isFullscreen ? 7 : 6}
        fill={alarm ? TEMP_ALARM_COLOR : TEMP_OK_COLOR}
        stroke="#ffffff"
        strokeWidth={3}
      />
    );
  };

  return (
    <div
      ref={outerRef}
      className="sensor-chart-root"
      style={{
        width: "100%",
        height: resolvedHeight,
        minHeight: 0,
        flex: "1 1 auto",
        display: "flex",
        flexDirection: "column",
        borderRadius: 24,
        overflow: "hidden",
        background:
          "radial-gradient(circle at 15% 0%, rgba(34,197,94,0.10), transparent 28%), linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
      }}
    >
      <div
        style={{
          height: chartHeaderHeight,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: "4px 10px 0",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 14px",
            borderRadius: 999,
            border: "1px solid rgba(148,163,184,0.22)",
            background: "rgba(255,255,255,0.86)",
            boxShadow: "0 10px 24px rgba(15,23,42,0.08)",
            color: "#0f172a",
            fontWeight: 950,
            fontSize: isFullscreen ? 14 : 13,
            whiteSpace: "nowrap",
          }}
        >
          <span
            style={{
              width: 24,
              height: 4,
              borderRadius: 999,
              background: TEMP_OK_COLOR,
              boxShadow: "0 0 0 4px rgba(22,163,74,0.10)",
            }}
          />
          <span>🌡 Nhiệt độ</span>
        </div>

        {!isCompact && latestTemp != null && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 12px",
              borderRadius: 999,
              background: "rgba(15,23,42,0.04)",
              color: "#334155",
              fontWeight: 900,
              fontSize: 12,
            }}
          >
            Hiện tại:{" "}
            <span style={{ color: latestAlarm ? TEMP_ALARM_COLOR : TEMP_OK_COLOR }}>{round1(latestTemp)}°C</span>
            <span style={{ color: "#94a3b8" }}>•</span>
            Min: {round1(minTemp)}°C
            <span style={{ color: "#94a3b8" }}>•</span>
            Max: {round1(maxTemp)}°C
          </div>
        )}
      </div>

      <div
        className="sensor-chart-responsive-shell"
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          width: "100%",
          height: `calc(100% - ${chartHeaderHeight}px)`,
          padding: isFullscreen ? "4px 12px 10px" : "4px 10px 10px",
        }}
      >
        <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={40}>
          <LineChart
            data={renderData}
            margin={{
              top: 8,
              right: isFullscreen ? 18 : 22,
              bottom: effectiveBrush ? 4 : 10,
              left: isFullscreen ? 4 : 0,
            }}
          >
            <defs>
              <linearGradient id="chartTempStroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#22c55e" stopOpacity={0.9} />
                <stop offset="100%" stopColor="#16a34a" stopOpacity={1} />
              </linearGradient>
            </defs>

            <CartesianGrid
              stroke="#e2e8f0"
              strokeDasharray="4 6"
              vertical
              horizontal
              opacity={0.72}
            />

            <XAxis
              dataKey="_x"
              type="number"
              domain={[0, Math.max(len - 1, 1)]}
              ticks={xTicks}
              tickFormatter={xTickFormatter}
              interval={0}
              allowDataOverflow
              axisLine={false}
              tickLine={false}
              tickMargin={12}
              height={isCompact ? 42 : 34}
              angle={isCompact ? -18 : 0}
              textAnchor={isCompact ? "end" : "middle"}
              tick={{
                fill: "#64748b",
                fontSize: isFullscreen ? 12 : 11,
                fontWeight: 800,
              }}
            />

            <YAxis
              yAxisId="left"
              domain={tempDomain}
              axisLine={false}
              tickLine={false}
              width={isFullscreen ? 52 : 50}
              tickCount={isFullscreen ? 6 : 5}
              tickFormatter={(v) => `${round1(v)}`}
              tick={{
                fill: "#475569",
                fontSize: isFullscreen ? 13 : 12,
                fontWeight: 850,
              }}
              label={
                isFullscreen
                  ? undefined
                  : {
                      value: "°C",
                      angle: -90,
                      position: "insideLeft",
                      fill: "#64748b",
                      fontSize: 13,
                      fontWeight: 900,
                    }
              }
            />

            {tempMinOk && (
              <>
                <ReferenceArea
                  yAxisId="left"
                  y1={tempDomain[0]}
                  y2={Number(tMin)}
                  ifOverflow="extendDomain"
                  fill={TEMP_SOFT_RED}
                  strokeOpacity={0}
                />

                <ReferenceLine
                  yAxisId="left"
                  y={Number(tMin)}
                  stroke={TEMP_ALARM_COLOR}
                  strokeDasharray="5 5"
                  strokeOpacity={0.9}
                  label={{
                    value: `Min ${round1(tMin)}°C`,
                    position: "insideTopLeft",
                    fill: TEMP_ALARM_COLOR,
                    fontSize: 11,
                    fontWeight: 900,
                  }}
                />
              </>
            )}

            {tempMaxOk && (
              <>
                <ReferenceArea
                  yAxisId="left"
                  y1={Number(tMax)}
                  y2={tempDomain[1]}
                  ifOverflow="extendDomain"
                  fill={TEMP_SOFT_RED}
                  strokeOpacity={0}
                />

                <ReferenceLine
                  yAxisId="left"
                  y={Number(tMax)}
                  stroke={TEMP_ALARM_COLOR}
                  strokeDasharray="5 5"
                  strokeOpacity={0.9}
                  label={{
                    value: `Max ${round1(tMax)}°C`,
                    position: "insideTopLeft",
                    fill: TEMP_ALARM_COLOR,
                    fontSize: 11,
                    fontWeight: 900,
                  }}
                />
              </>
            )}

            <ReferenceArea
              yAxisId="left"
              y1={tempMinOk ? Number(tMin) : tempDomain[0]}
              y2={tempMaxOk ? Number(tMax) : tempDomain[1]}
              ifOverflow="extendDomain"
              fill={TEMP_SOFT_GREEN}
              strokeOpacity={0}
            />

            <Tooltip
              content={<CustomTooltip />}
              cursor={{
                stroke: "#94a3b8",
                strokeDasharray: "4 4",
                strokeWidth: 1.5,
              }}
              wrapperStyle={{ outline: "none" }}
              isAnimationActive={false}
            />

            {/*
              Line nền xanh vẽ toàn bộ để biểu đồ luôn liền mạch.
              Red overlay phủ lên các đoạn ngoài ngưỡng.
              Không hiện dot tĩnh; chỉ hover mới hiện 1 chấm.
            */}
            <Line
              yAxisId="left"
              type="linear"
              dataKey="tempBase"
              stroke={TEMP_OK_COLOR}
              strokeWidth={8}
              strokeOpacity={0.12}
              dot={false}
              activeDot={false}
              connectNulls
              isAnimationActive={false}
              legendType="none"
            />
            <Line
              yAxisId="left"
              type="linear"
              dataKey="tempBase"
              stroke={TEMP_OK_COLOR}
              strokeWidth={isFullscreen ? 3.2 : 2.8}
              dot={false}
              activeDot={false}
              connectNulls
              isAnimationActive={animate}
              animationDuration={420}
              animationEasing="ease-in-out"
              name="Nhiệt độ"
              legendType="none"
            />

            {/* Red overlay: chỉ phủ đoạn ngoài ngưỡng, nằm trên line xanh nên không bị hở */}
            <Line
              yAxisId="left"
              type="linear"
              dataKey="tempAlarm"
              stroke={TEMP_ALARM_COLOR}
              strokeWidth={9}
              strokeOpacity={0.14}
              dot={false}
              activeDot={false}
              connectNulls={false}
              isAnimationActive={false}
              legendType="none"
            />
            <Line
              yAxisId="left"
              type="linear"
              dataKey="tempAlarm"
              stroke={TEMP_ALARM_COLOR}
              strokeWidth={isFullscreen ? 3.6 : 3.2}
              dot={false}
              activeDot={false}
              connectNulls={false}
              isAnimationActive={animate}
              animationDuration={420}
              animationEasing="ease-in-out"
              name="Nhiệt độ cảnh báo"
              legendType="none"
            />

            {/* Line vô hình chỉ để bắt hover và hiện đúng 1 chấm tại điểm đang trỏ chuột */}
            <Line
              yAxisId="left"
              type="linear"
              dataKey="tempHover"
              stroke="transparent"
              strokeWidth={18}
              dot={false}
              activeDot={renderActiveDot as any}
              connectNulls
              isAnimationActive={false}
              name="Nhiệt độ"
              legendType="none"
            />
            {effectiveBrush && (
              <Brush
                dataKey="_label"
                height={isFullscreen ? 34 : 28}
                stroke="#22c55e"
                travellerWidth={12}
                fill="#f8fafc"
                tickFormatter={(v: any) => String(v ?? "")}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}