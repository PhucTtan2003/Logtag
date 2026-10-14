// src/pages/User/userchart/types.ts
export type LiveWindow = "1h" | "6h" | "24h" | "7d" | "30d" | "62d";

export type Point = {
  [x: string]: any;
  timestamp?: any; // optional để src/lib/chartUtils.ts mapPoints cũ không bị TS2322
  label: string;
  temperature?: number;
  humidity?: number;
};
