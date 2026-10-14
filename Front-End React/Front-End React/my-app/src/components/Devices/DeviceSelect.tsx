import React from "react";
import { X } from "lucide-react";
import { DeviceLite } from "../../hooks/useDeviceList";

type Props = {
  deviceList: DeviceLite[];
  selectedDevice: string;
  onChange: (sn: string) => void;
  onClear: () => void;
  isAllowed: (sn: string) => boolean;
};

export default function DeviceSelect({
  deviceList,
  selectedDevice,
  onChange,
  onClear,
  isAllowed,
}: Props) {
  return (
    <div className="device-filter-bar">
      <div className="device-dropdown">
        <label htmlFor="device-select">Thiết bị:</label>
        <select
          id="device-select"
          value={selectedDevice}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Chọn thiết bị"
        >
          {deviceList.length === 0 && <option value="">(Không có thiết bị)</option>}
          {deviceList.map((d) => (
            <option
              key={d.serialNumber}
              value={d.serialNumber}
              disabled={!isAllowed(d.serialNumber)}
            >
              {d.serialNumber}{d.model ? ` · ${d.model}` : ""}
            </option>
          ))}
        </select>

        {selectedDevice && (
          <button
            className="badge-clear"
            onClick={onClear}
            aria-label="Bỏ chọn thiết bị"
            title="Bỏ chọn"
            type="button"
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );
}