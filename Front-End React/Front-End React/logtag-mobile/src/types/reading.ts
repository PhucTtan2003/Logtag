export type ReadingPoint = {
  serialNumber: string;
  dateUtc: string;
  temperature: number | null;
  humidity: number | null;
};