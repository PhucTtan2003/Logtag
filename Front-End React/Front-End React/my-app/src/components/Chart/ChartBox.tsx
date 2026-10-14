import React, { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import "../../styles/Chart/ChartBox.css";

import Chart from "./Chart";
import LoadingOverlay from "../LoadingOverlay";
import DeviceSelect from "../../components/Devices/DeviceSelect";
import RangeControls from "../RangeControls";
import LiveControls from "../LiveControls";
import ExportButtons from "../../components/Export/ExportButtons";

import api from "../../api/axios";
import { toUtcIsoForQuery, toLocalInputValue } from "../../utils/time";
import { buildExportRange, type NormalizedExportRange } from "../../utils/exportRange";
import { useSensorChartDataRange, type DataPoint } from "../../hooks/useSensorChartDataRange";
import { useDeviceList } from "../../hooks/useDeviceList";
import { useLiveReadings } from "../../hooks/useLiveReadings";
import type { LiveWindow } from "../../types/liveWindow"; // ✅ export riêng type

import { exportExcel, exportPDF } from "../../utils/exporters";

type Props = {
  allowedSerials?: string[];
  defaultSerial?: string;
};

export default function ChartBox({ allowedSerials, defaultSerial }: Props) {
  // ===== Devices
  const { deviceList, selectedDevice, setSelectedDevice, isAllowed } =
    useDeviceList(allowedSerials, defaultSerial);

  const clearDevice = () => {
    setSelectedDevice("");
    setLiveMode(false);
  };

  // ===== Time range defaults
  const now = new Date();
  const defaultToLocal = toLocalInputValue(now);
  const defaultFromLocalStr = toLocalInputValue(
    new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0)
  );

  const [fromLocal, setFromLocal] = useState(defaultFromLocalStr);
  const [toLocal, setToLocal] = useState(defaultToLocal);

  const fromUtc = useMemo(() => toUtcIsoForQuery(fromLocal), [fromLocal]);
  const toUtc = useMemo(() => toUtcIsoForQuery(toLocal), [toLocal]);

  // ===== Live / History mode
  const [liveMode, setLiveMode] = useState(true);
  const [liveWindow, setLiveWindow] = useState<LiveWindow>("1h" as LiveWindow);

  const {
    liveData,
    loading: liveLoading,
    latencyMs,
  } = useLiveReadings(selectedDevice, liveWindow, liveMode);

  // Local state để pause/resume realtime
  const [livePaused, setLivePaused] = useState<boolean>(false);

  // ===== Historical data
  const {
    data: chartData,
    loading: histLoading,
    error,
    refetch,
  } = useSensorChartDataRange(selectedDevice, fromUtc, toUtc, !liveMode);

  // ===== Merge data
  const effectiveData: DataPoint[] = useMemo(() => {
    const raw = liveMode ? liveData : chartData;
    return raw.map((d) => ({
      ...d,
      time: (d as any).time ?? (d as any).timestamp ?? "",
      temperature: d.temperature ?? 0,
      humidity: d.humidity ?? 0,
    }));
  }, [liveMode, liveData, chartData]);

  const effectiveLoading = liveMode ? liveLoading : histLoading;
  const effectiveError = !liveMode ? error : null;
  const liveLatencyMs = latencyMs;

  // ===== Stats
  const tMin = useMemo(
    () => (effectiveData.length ? Math.min(...effectiveData.map((d) => d.temperature)) : 0),
    [effectiveData]
  );
  const tMax = useMemo(
    () => (effectiveData.length ? Math.max(...effectiveData.map((d) => d.temperature)) : 0),
    [effectiveData]
  );
  const hMin = useMemo(
    () => (effectiveData.length ? Math.min(...effectiveData.map((d) => d.humidity)) : 0),
    [effectiveData]
  );
  const hMax = useMemo(
    () => (effectiveData.length ? Math.max(...effectiveData.map((d) => d.humidity)) : 0),
    [effectiveData]
  );

  const chartPanelRef = useRef<HTMLDivElement | null>(null);

  // ===== Preset range helpers
  const setToday = () => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0);
    setFromLocal(toLocalInputValue(from));
    setToLocal(toLocalInputValue(now));
  };
  const setYesterday = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59);
    setFromLocal(toLocalInputValue(start));
    setToLocal(toLocalInputValue(end));
  };
  const set7d = () => {
    const now = new Date();
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    setFromLocal(toLocalInputValue(start));
    setToLocal(toLocalInputValue(now));
  };

  // ===== Sync readings
  const [syncBusy, setSyncBusy] = useState(false);
  const handleFetchLocationReadings = async () => {
    if (!selectedDevice || !fromUtc || !toUtc || new Date(fromUtc) > new Date(toUtc)) return;
    try {
      setSyncBusy(true);
      await api.post("/api/logtag/location-readings", {
        serialNumber: selectedDevice,
        from: fromUtc,
        to: toUtc,
      });
      if (!liveMode) await refetch();
    } finally {
      setSyncBusy(false);
    }
  };

  // ===== Export actions
  const [exportBusy, setExportBusy] = useState(false);

  const getPickedRange = (pickedFromLocal?: string, pickedToLocal?: string): NormalizedExportRange => {
    return buildExportRange({
      fromLocal: pickedFromLocal ?? fromLocal,
      toLocal: pickedToLocal ?? toLocal,
    });
  };

  const onExportExcel = async (pickedFromLocal?: string, pickedToLocal?: string) => {
    if (!selectedDevice) return;
    const pickedRange = getPickedRange(pickedFromLocal, pickedToLocal);

    try {
      setExportBusy(true);
      await exportExcel({
        selectedDevice,
        fromUtc: pickedRange.fromUtc,
        toUtc: pickedRange.toUtc,
        fromLocal: pickedRange.fromLocal,
        toLocal: pickedRange.toLocal,
        rangeText: pickedRange.rangeText,
        rangeLabel: pickedRange.label,
        rangeDisplayText: pickedRange.rangeText,
        rangeDays: pickedRange.days,
        normalizedRange: pickedRange,
      });
    } finally {
      setExportBusy(false);
    }
  };

  const onExportPDF = async (pickedFromLocal?: string, pickedToLocal?: string) => {
    if (!selectedDevice) return;

    const pickedRange = getPickedRange(pickedFromLocal, pickedToLocal);

    const allowedWindows = ["1h", "6h", "24h", "7d"] as const;
    const safeLiveWindow = allowedWindows.includes(liveWindow as any)
      ? (liveWindow as "1h" | "6h" | "24h" | "7d")
      : "1h";

    await exportPDF({
      selectedDevice,
      // Khi bấm popup export thì luôn xuất theo khoảng đã chọn, không phụ thuộc Realtime 1h/7d ngoài màn hình.
      liveMode: false,
      liveWindow: safeLiveWindow,
      fromUtc: pickedRange.fromUtc,
      toUtc: pickedRange.toUtc,
      fromLocal: pickedRange.fromLocal,
      toLocal: pickedRange.toLocal,
      rangeText: pickedRange.rangeText,
      rangeLabel: pickedRange.label,
      rangeDisplayText: pickedRange.rangeText,
      rangeDays: pickedRange.days,
      normalizedRange: pickedRange,
      tMin,
      tMax,
      hMin,
      hMax,
      chartPanel: chartPanelRef.current,
    });
  };

  const canInteract = !!selectedDevice && isAllowed(selectedDevice);

  const rangeLabel = useMemo(() => {
    const fmt = (s: string) => (s ? new Date(s).toLocaleString() : "—");
    return `${fmt(fromUtc)} → ${fmt(toUtc)}`;
  }, [fromUtc, toUtc]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="chart-box-wow"
      role="region"
      aria-label="Sensor chart container"
    >
      {/* Device selector */}
      <DeviceSelect
        deviceList={deviceList}
        selectedDevice={selectedDevice}
        onChange={setSelectedDevice}
        onClear={clearDevice}
        isAllowed={isAllowed}
      />

      {/* Controls */}
      <div className="filter-group-modern">
        <LiveControls
          liveMode={liveMode}
          setLiveMode={setLiveMode}
          liveWindow={liveWindow}
          setLiveWindow={setLiveWindow}
          livePaused={livePaused}
          togglePause={() => setLivePaused((p: boolean) => !p)}
          latencyMs={liveLatencyMs}
          disabled={!canInteract}
        />

        {!liveMode && (
          <RangeControls
            fromLocal={fromLocal}
            toLocal={toLocal}
            setFromLocal={setFromLocal}
            setToLocal={setToLocal}
            onRefetch={refetch}
            disabled={!canInteract}
            onPresetToday={setToday}
            onPresetYesterday={setYesterday}
            onPreset7d={set7d}
            onSyncReadings={handleFetchLocationReadings}
            syncing={syncBusy}
            titleOfSyncBtn={`Đồng bộ: ${fromUtc ? new Date(fromUtc).toLocaleString() : "—"} → ${
              toUtc ? new Date(toUtc).toLocaleString() : "—"
            }`}
          />
        )}
      </div>

      <h3 className="chart-heading-wow">
        📊 Biểu đồ{" "}
        <span>
          (Thiết bị {selectedDevice || "—"} - {liveMode ? `Realtime ${liveWindow}` : rangeLabel})
        </span>
      </h3>

      <div className="chart-stats-mini">
        <div className="stat-chip">🌡️ T Min: <b>{tMin.toFixed(1)}°C</b></div>
        <div className="stat-chip">🌡️ T Max: <b>{tMax.toFixed(1)}°C</b></div>
        <div className="stat-chip">💧 H Min: <b>{hMin.toFixed(1)}%</b></div>
        <div className="stat-chip">💧 H Max: <b>{hMax.toFixed(1)}%</b></div>
      </div>

      <div className="chart-box-panel glow-on-hover" ref={chartPanelRef}>
        {effectiveLoading && <LoadingOverlay />}
        {!effectiveLoading && effectiveError && (
          <div className="chart-error">{effectiveError}</div>
        )}
        {!effectiveLoading && !effectiveError && effectiveData.length === 0 && (
          <div className="chart-empty">Không có dữ liệu</div>
        )}
        {!effectiveLoading && !effectiveError && effectiveData.length > 0 && (
          <Chart
            data={effectiveData}
            tempThresholds={{ min: 2, max: 8 }}
            humThresholds={{ min: 30, max: 70 }}
            showBrush
          />
        )}
      </div>

      {/* Export buttons */}
      <ExportButtons
        onExportExcel={onExportExcel}
        onExportPDF={onExportPDF}
        onRefresh={refetch}
        onSyncReadings={handleFetchLocationReadings}
        disabled={!canInteract || exportBusy}
        selectedSerial={selectedDevice || undefined}
      />
    </motion.div>
  );
}
