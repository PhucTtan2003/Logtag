export type LiveWindow = "1h" | "6h" | "24h" | "7d" | "30d" | "62d";

export type Point = {
  timestamp: any;
  label: string;
  temperature?: number;
  humidity?: number;
  [x: string]: any;
};
