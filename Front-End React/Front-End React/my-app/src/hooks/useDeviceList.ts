import { useEffect, useMemo, useState } from "react";
import { getWithRetry, userIdHeader } from "../utils/http";

export interface DeviceLite {
  serialNumber: string;
  model?: string;
  name?: string;
}

export function useDeviceList(allowedSerials?: string[], defaultSerial?: string) {
  const [deviceList, setDeviceList] = useState<DeviceLite[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>("");

  const allowedSet = useMemo(
    () => new Set((allowedSerials ?? []).map((s) => (s || "").toUpperCase())),
    [allowedSerials]
  );
  const isAllowed = (sn: string) =>
    !allowedSerials || allowedSet.has((sn || "").toUpperCase());

  useEffect(() => {
    let ignore = false;

    const fromAllowed = () => {
      const items = (allowedSerials ?? []).map((sn) => ({ serialNumber: sn }));
      setDeviceList(items);
      const first = items[0]?.serialNumber;
      const pick =
        defaultSerial && isAllowed(defaultSerial) ? defaultSerial : first;
      if (pick) setSelectedDevice(pick);
    };

    const fromApi = async () => {
      try {
        const url = "/api/sensordata/GetDeviceSerials";
        const res = await getWithRetry(url, { headers: { ...userIdHeader() } });
        const list: string[] = Array.isArray(res.data) ? res.data : [];
        const items: DeviceLite[] = list.map((sn) => ({ serialNumber: sn }));
        if (!ignore) {
          setDeviceList(items);
          const first = items[0]?.serialNumber;
          const pick =
            defaultSerial && list.includes(defaultSerial)
              ? defaultSerial
              : first;
          if (pick) setSelectedDevice(pick);
        }
      } catch {
        if (!ignore) setDeviceList([]);
      }
    };

    if (allowedSerials && allowedSerials.length > 0) fromAllowed();
    else fromApi();

    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedSerials, defaultSerial]);

  return { deviceList, selectedDevice, setSelectedDevice, isAllowed };
}