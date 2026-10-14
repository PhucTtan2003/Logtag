import React from "react";
import { RefreshCw } from "lucide-react";

type Props = {
  fromLocal: string;
  toLocal: string;
  setFromLocal: (v: string) => void;
  setToLocal: (v: string) => void;
  onRefetch: () => void;
  disabled: boolean;
  onPresetToday: () => void;
  onPresetYesterday: () => void;
  onPreset7d: () => void;
  onSyncReadings: () => void;
  syncing: boolean;
  titleOfSyncBtn: string;
};

export default function RangeControls({
  fromLocal,
  toLocal,
  setFromLocal,
  setToLocal,
  onRefetch,
  disabled,
  onPresetToday,
  onPresetYesterday,
  onPreset7d,
  onSyncReadings,
  syncing,
  titleOfSyncBtn,
}: Props) {
  return (
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
          onClick={onRefetch}
          disabled={disabled}
          aria-label="Lọc"
          type="button"
        >
          <RefreshCw size={14} /> Lọc
        </button>
      </div>

      {/* <div className="filter-item ripple">
        <button
          className="btn-refresh"
          onClick={onSyncReadings}
          disabled={disabled || syncing}
          aria-label="Đồng bộ readings về DB"
          title={titleOfSyncBtn}
          type="button"
        >
          <RefreshCw size={14} />
          {syncing ? " Đang đồng bộ..." : " Đồng bộ readings"}
        </button>
      </div> */}
    </>
  );
}