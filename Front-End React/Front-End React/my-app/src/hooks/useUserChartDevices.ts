import { useEffect, useState } from "react";
import { createHttp } from "../pages/User/userchart/lib/http";

export function useDeviceList() {
  const { dedupGet } = createHttp();
  const [deviceIds, setDeviceIds] = useState<string[]>([]);
  const [usingPublicList, setUsingPublicList] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;

    // cache
    const cached = localStorage.getItem("myDeviceIds");
    const cachedSel = localStorage.getItem("mySelectedDevice");
    if (cached) {
      try {
        const arr = JSON.parse(cached);
        if (Array.isArray(arr) && arr.length > 0) {
          setDeviceIds(arr);
          setSelected(cachedSel && arr.includes(cachedSel) ? cachedSel : arr[0]);
        }
      } catch {}
    }

    (async () => {
      const uid = localStorage.getItem("accountId") || localStorage.getItem("uid") || "";
      let ids: string[] = [];

      try {
        if (uid) {
          const list = await dedupGet<any[]>(`/api/sensordata/GetDevicesByAccount/${uid}`);
          ids = (Array.isArray(list) ? list : [])
            .map((d: any) => String(d.serialNumber ?? d.deviceId ?? d.id ?? ""))
            .filter(Boolean);
        }
      } catch {}

      if (!ids.length) {
        try {
          const alt = await dedupGet<any[]>("/api/sensordata/GetDeviceSerials");
          ids = (Array.isArray(alt) ? alt : []).map((x: any) => String(x)).filter(Boolean);
          if (ids.length) setUsingPublicList(true);
        } catch {}
      }

      if (!ignore && ids.length) {
        setDeviceIds(ids);
        setSelected((prev) => {
          const v = prev && ids.includes(prev) ? prev : ids[0];
          localStorage.setItem("mySelectedDevice", v);
          return v;
        });
        localStorage.setItem("myDeviceIds", JSON.stringify(ids));
      }
    })();

    return () => { ignore = true; };
  }, [dedupGet]);

  return { deviceIds, selected, setSelected, usingPublicList };
}
