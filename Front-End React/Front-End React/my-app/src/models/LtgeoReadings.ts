export interface LtgeoReading {
  temperature: number;
  humidity?: number | null;
  lux?: number | null;
  shock?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  dateUtc: string;
}

export interface LtgeoReadingsEnvelope {
  data: LtgeoReading[];
  status: string;
  timestampUtc: string;
}