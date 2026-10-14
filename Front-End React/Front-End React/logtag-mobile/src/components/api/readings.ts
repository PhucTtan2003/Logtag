import { api } from "./client";
import type { ReadingPoint } from "../../types/reading";

type RecentReadingsResponse = {
  status?: string;
  serialNumber?: string;
  total?: number;
  items?: ReadingPoint[];
  data?: ReadingPoint[];
};

export async function getRecentReadings(
  serial: string,
  minutes = 60,
  limit = 120
): Promise<ReadingPoint[]> {
  const res = await api.get<RecentReadingsResponse>(
    "/api/mobile/v1/readings/recent",
    {
      params: {
        serial,
        minutes,
        limit,
      },
    }
  );

  const rows = res.data.items ?? res.data.data ?? [];

  return rows
    .filter((x) => x && x.dateUtc)
    .sort(
      (a, b) =>
        new Date(a.dateUtc).getTime() - new Date(b.dateUtc).getTime()
    );
}