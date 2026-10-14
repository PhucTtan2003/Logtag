import { useEffect, useState } from 'react';
import api from '../../api/axios'; // 
import '../../styles/Devices/DeviceFilter.css';

type Props = {
  selectedDevice: string;
  onSelectDevice: (id: string) => void;
};

export default function DeviceFilter({ selectedDevice, onSelectDevice }: Props) {
  const [deviceList, setDeviceList] = useState<string[]>([]);

  useEffect(() => {
    const fetchDeviceIds = async () => {
      try {
        const res = await api.get('/api/sensordata/GetDeviceSerials');
        const data = res.data;
        const ids = data.map((id: any) => {
          // Nếu là object dạng { $oid: "xxx" } thì lấy id.$oid
          if (typeof id === "object" && id.$oid) return id.$oid;
          return id.toString();
        });
        setDeviceList(ids);

        // Gán mặc định thiết bị đầu tiên nếu chưa có
        if (ids.length > 0 && !selectedDevice) {
          onSelectDevice(ids[0]);
        }
      } catch (err) {
        console.error('Lỗi khi lấy danh sách thiết bị:', err);
      }
    };

    fetchDeviceIds();
    // eslint-disable-next-line
  }, [onSelectDevice, selectedDevice]);

  return (
    <div className="device-filter">
      <label htmlFor="deviceSelect" className="device-label">Thiết bị:</label>
      <select
        id="deviceSelect"
        value={selectedDevice}
        onChange={(e) => onSelectDevice(e.target.value)}
        className="device-select"
      >
        {deviceList.map((id) => (
          <option key={id} value={id}>
            Thiết bị {id}
          </option>
        ))}
      </select>
    </div>
  );
}