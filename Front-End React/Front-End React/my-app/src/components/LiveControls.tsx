// src/components/LiveControls.tsx
import React from "react";
import { Activity, Pause, Play, Clock3 } from "lucide-react";
import type { LiveWindow } from "../types/liveWindow";

type Props = {
  liveMode: boolean;
  setLiveMode: (v: boolean) => void;
  liveWindow: LiveWindow;
  setLiveWindow: (w: LiveWindow) => void;
  livePaused: boolean;
  togglePause: () => void;
  latencyMs: number | null;
  disabled: boolean;
};

export default function LiveControls({
  liveMode,
  setLiveMode,
  liveWindow,
  setLiveWindow,
  livePaused,
  togglePause,
  latencyMs,
  disabled,
}: Props) {
  return (
    <>
      {/* Bật/tắt realtime */}
      <div className="filter-item ripple">
        <label className={`toggle-live ${disabled ? "disabled" : ""}`}>
          <input
            type="checkbox"
            checked={liveMode}
            onChange={(e) => setLiveMode(e.target.checked)}
            disabled={disabled}
            aria-label="Bật/tắt realtime"
          />
          <span className="slider" />
          <span className="label">
            <Activity size={16} /> Realtime
          </span>
        </label>
      </div>

      {liveMode && (
        <>
          <div className="filter-item ripple">
            <label htmlFor="live-window">Cửa sổ realtime:</label>
            <select
              id="live-window"
              value={liveWindow}
              onChange={(e) => setLiveWindow(e.target.value as LiveWindow)}
              disabled={disabled}
            >
              <option value="1h">1 giờ</option>
              <option value="6h">6 giờ</option>
              <option value="24h">24 giờ</option>
              <option value="7d">7 ngày</option>
              <option value="30d">30 ngày</option>
              <option value="62d">62 ngày</option>
            </select>
          </div>

          <div className="filter-item ripple">
            <button
              className="btn-pause"
              onClick={togglePause}
              disabled={disabled}
              aria-label={livePaused ? "Tiếp tục" : "Tạm dừng"}
              type="button"
            >
              {livePaused ? (
                <>
                  <Play size={14} /> Tiếp tục
                </>
              ) : (
                <>
                  <Pause size={14} /> Tạm dừng
                </>
              )}
            </button>
          </div>

          <div className="filter-item latency">
            <Clock3 size={14} />
            <span>Latency: {latencyMs != null ? `${latencyMs} ms` : "—"}</span>
          </div>
        </>
      )}
    </>
  );
}