export type DbEvent = {
  serialNumber: string;
  eventType: string;
  eventTimeUtc: string; // ISO (UTC)
  alarmThreshold?: number;
  alarmValue?: number;
  alarmCount?: number;
  batteryType?: string;
};

export type LogTagEventsResponse = {
  status: string;
  timestampUtc: string;
  data: {
    eventType: string;
    eventTimeUtc: string;
    alarmThreshold?: number;
    alarmValue?: number;
    alarmCount?: number;
    batteryType?: string;
  }[];
};
