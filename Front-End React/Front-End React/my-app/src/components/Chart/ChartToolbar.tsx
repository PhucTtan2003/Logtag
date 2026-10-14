import React from "react";
import { Activity, Pause, Play, RefreshCw } from "lucide-react";

import ExportExcelButton from "../../components/Export/ExportExcelButton";

type LiveWindow = "1h" | "6h" | "24h" | "7d";

type Props = {
  liveMode: boolean;
  setLiveMode: (v: boolean) => void;
  liveWindow: LiveWindow;
  setLiveWindow: (v: LiveWindow) => void;
  livePaused: boolean;
  setLivePaused: (v: boolean) => void;

  fromLocal: string;
  toLocal: string;
  setFromLocal: (v: string) => void;
  setToLocal: (v: string) => void;

  onPresetToday: () => void;
  onPresetYesterday: () => void;
  onPreset7d: () => void;
  onApplyRange: () => void;

  selectedSerial?: string;

  disabled?: boolean;
};

export default function ChartToolbar(props: Props) {
  const {
    liveMode, setLiveMode, liveWindow, setLiveWindow, livePaused, setLivePaused,
    fromLocal, toLocal, setFromLocal, setToLocal,
    onPresetToday, onPresetYesterday, onPreset7d, onApplyRange,
    selectedSerial, 
    disabled
  } = props;

  return (
    <div className="filter-group-modern">
      {/* Live toggle */}
      <div className="filter-item ripple">
        <label className="toggle-live">
          <input
            type="checkbox"
            checked={liveMode}
            onChange={(e) => setLiveMode(e.target.checked)}
            disabled={disabled}
            aria-label="Bật/tắt realtime"
          />
          <span className="slider" />
          <span className="label"><Activity size={16} /> Realtime</span>
        </label>
      </div>

      {!liveMode && (
        <>
          <div className="filter-item ripple">
            <label htmlFor="from-dt">Từ:</label>
            <input
              id="from-dt"
              type="datetime-local"
              value={fromLocal}
              onChange={(e) => setFromLocal(e.target.value)}
            />
          </div>
          <div className="filter-item ripple">
            <label htmlFor="to-dt">Đến:</label>
            <input
              id="to-dt"
              type="datetime-local"
              value={toLocal}
              onChange={(e) => setToLocal(e.target.value)}
            />
          </div>

          <div className="filter-item quick-presets">
            <button className="chip" onClick={onPresetToday}>Hôm nay</button>
            <button className="chip" onClick={onPresetYesterday}>Hôm qua</button>
            <button className="chip" onClick={onPreset7d}>7 ngày</button>
          </div>

          <div className="filter-item ripple">
            <button
              className="btn-refresh"
              onClick={onApplyRange}
              disabled={disabled}
              aria-label="Lọc"
            >
              <RefreshCw size={14} /> Lọc
            </button>
          </div>
        </>
      )}

      {liveMode && (
        <>
<div className="filter-item ripple">
            <label htmlFor="live-window">Cửa sổ realtime:</label>
            <select
              id="live-window"
              value={liveWindow}
              onChange={(e) => setLiveWindow(e.target.value as LiveWindow)}
            >
              <option value="1h">1 giờ</option>
              <option value="6h">6 giờ</option>
              <option value="24h">24 giờ</option>
              <option value="7d">7 ngày</option>
            </select>
          </div>

            <div className="filter-item ripple">
              <button
                className="btn-pause"
                onClick={() => setLivePaused(!livePaused)}
                disabled={disabled}
                aria-label={livePaused ? "Tiếp tục" : "Tạm dừng"}
              >
                {livePaused ? <><Play size={14}/> Tiếp tục</> : <><Pause size={14}/> Tạm dừng</>}
              </button>
            </div>
        </>
      )}

      {/* ✅ THÊM: xuất Excel bằng popup "Từ/Đến" (≤ 62 ngày) */}
      <div className="filter-item ripple" style={{ marginLeft: "auto" }}>
        <ExportExcelButton selectedSerial={selectedSerial} />
      </div>
    </div>
  );
}