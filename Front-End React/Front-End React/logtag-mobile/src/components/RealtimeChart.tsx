import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import Svg, {
  Circle,
  Line,
  Path,
  Text as SvgText,
} from "react-native-svg";

import { getRecentReadings } from "../components/api/readings";
import type { ReadingPoint } from "../types/reading";
import {
  chartColors,
  chartStyles as styles,
} from "../app/styles/realtime-chart.styles";

type Props = {
  serial: string;
  minutes?: number;
  refreshMs?: number;
};

export function RealtimeChart({
  serial,
  minutes = 60,
  refreshMs = 5000,
}: Props) {
  const [rows, setRows] = useState<ReadingPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [chartWidth, setChartWidth] = useState(320);

  async function loadData(isRefresh = false) {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      setError("");

      const data = await getRecentReadings(serial, minutes, 180);
      setRows(data);
    } catch (err: any) {
      const message =
        err?.response?.data?.message ||
        err?.message ||
        "Không lấy được dữ liệu chart.";
      setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadData(false);

    const timer = setInterval(() => {
      loadData(true);
    }, refreshMs);

    return () => clearInterval(timer);
  }, [serial, minutes, refreshMs]);

  const chart = useMemo(() => {
    const valid = rows
      .filter((x) => typeof x.temperature === "number")
      .map((x) => ({
        time: new Date(x.dateUtc).getTime(),
        temp: Number(x.temperature),
        humidity:
          typeof x.humidity === "number" ? Number(x.humidity) : null,
        dateUtc: x.dateUtc,
      }));

    if (valid.length === 0) {
      return null;
    }

    const width = Math.max(260, chartWidth);
    const height = 180;
    const padLeft = 36;
    const padRight = 14;
    const padTop = 18;
    const padBottom = 30;

    const plotWidth = width - padLeft - padRight;
    const plotHeight = height - padTop - padBottom;

    const temps = valid.map((x) => x.temp);
    let min = Math.min(...temps);
    let max = Math.max(...temps);

    if (min === max) {
      min -= 1;
      max += 1;
    }

    const padding = Math.max(0.5, (max - min) * 0.15);
    min -= padding;
    max += padding;

    const xForIndex = (index: number) => {
      if (valid.length === 1) return padLeft + plotWidth / 2;
      return padLeft + (index / (valid.length - 1)) * plotWidth;
    };

    const yForTemp = (temp: number) => {
      const ratio = (temp - min) / (max - min);
      return padTop + plotHeight - ratio * plotHeight;
    };

    const path = valid
      .map((point, index) => {
        const x = xForIndex(index);
        const y = yForTemp(point.temp);
        return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");

    const latest = valid[valid.length - 1];
    const latestX = xForIndex(valid.length - 1);
    const latestY = yForTemp(latest.temp);

    return {
      width,
      height,
      path,
      latest,
      latestX,
      latestY,
      min,
      max,
      padLeft,
      padRight,
      padTop,
      padBottom,
      plotWidth,
      plotHeight,
    };
  }, [rows, chartWidth]);

  const latestRow = rows[rows.length - 1];

  return (
    <View
      style={styles.card}
      onLayout={(e) => {
        const width = e.nativeEvent.layout.width;
        if (width > 0) setChartWidth(width - 24);
      }}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Biểu đồ realtime</Text>
          <Text style={styles.subtitle}>{serial}</Text>
        </View>

        <Pressable style={styles.refreshButton} onPress={() => loadData(true)}>
          <Text style={styles.refreshText}>
            {refreshing ? "..." : "Làm mới"}
          </Text>
        </Pressable>
      </View>

      {latestRow ? (
        <View style={styles.latestRow}>
          <View style={styles.latestBox}>
            <Text style={styles.latestLabel}>Nhiệt độ</Text>
            <Text style={styles.latestValue}>
              {formatNumber(latestRow.temperature)}°C
            </Text>
          </View>

          <View style={styles.latestBox}>
            <Text style={styles.latestLabel}>Độ ẩm</Text>
            <Text style={styles.latestValue}>
              {formatNumber(latestRow.humidity)}%
            </Text>
          </View>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator />
          <Text style={styles.mutedText}>Đang tải dữ liệu...</Text>
        </View>
      ) : error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : !chart ? (
        <View style={styles.centerBox}>
          <Text style={styles.mutedText}>Chưa có dữ liệu để vẽ chart.</Text>
        </View>
      ) : (
        <View style={styles.chartBox}>
          <Svg width={chart.width} height={chart.height}>
            <Line
              x1={chart.padLeft}
              y1={chart.padTop}
              x2={chart.padLeft}
              y2={chart.height - chart.padBottom}
              stroke="#334155"
              strokeWidth="1"
            />
            <Line
              x1={chart.padLeft}
              y1={chart.height - chart.padBottom}
              x2={chart.width - chart.padRight}
              y2={chart.height - chart.padBottom}
              stroke="#334155"
              strokeWidth="1"
            />

            <Line
              x1={chart.padLeft}
              y1={chart.padTop}
              x2={chart.width - chart.padRight}
              y2={chart.padTop}
              stroke="#1e293b"
              strokeWidth="1"
            />
            <Line
              x1={chart.padLeft}
              y1={chart.padTop + chart.plotHeight / 2}
              x2={chart.width - chart.padRight}
              y2={chart.padTop + chart.plotHeight / 2}
              stroke="#1e293b"
              strokeWidth="1"
            />

            <SvgText
              x={4}
              y={chart.padTop + 4}
              fill="#94a3b8"
              fontSize="10"
            >
              {chart.max.toFixed(1)}
            </SvgText>

            <SvgText
              x={4}
              y={chart.height - chart.padBottom + 4}
              fill="#94a3b8"
              fontSize="10"
            >
              {chart.min.toFixed(1)}
            </SvgText>

            <Path
              d={chart.path}
              stroke="#38bdf8"
              strokeWidth="3"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            <Circle
              cx={chart.latestX}
              cy={chart.latestY}
              r="5"
              fill="#38bdf8"
            />
          </Svg>
        </View>
      )}

      <Text style={styles.footerText}>
        Tự cập nhật mỗi {Math.round(refreshMs / 1000)} giây • {rows.length} điểm
      </Text>
    </View>
  );
}

function formatNumber(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "--";
  return value.toFixed(1);
}