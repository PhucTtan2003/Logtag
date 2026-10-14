import axios from "axios";
import { LtgeoReadingsEnvelope } from "../models/LtgeoReadings";

const API_ROOT = "api";

// USER: /api/lt5
const lt5UserApi = axios.create({
  baseURL: `${API_ROOT}/lt5`,
  headers: { "Content-Type": "application/json" },
  withCredentials: true,
});

// ADMIN: /api/admin/lt5
const lt5AdminApi = axios.create({
  baseURL: `${API_ROOT}/admin/lt5`,
  headers: { "Content-Type": "application/json" },
  withCredentials: true,
});

export interface Lt5Request {
  serialNumber: string;
  startUtc?: string | null;
  endUtc?: string | null;
}

// =======================
// Helpers (FE filter)
// =======================
function normalizeSerial(x: any): string {
  return (x ?? "").toString().trim().toUpperCase();
}

/**
 * FE filter "Cách 2":
 * - Chỉ giữ LT5GEO (ví dụ: serial kết thúc bằng 157C)
 * - Loại UTRED channel kiểu "-CH1", "-CH2"...
 *
 * ✅ Bạn có thể đổi rule cho khớp DeviceSerialHelper.IsLt5Geo của BE
 */
function isLt5GeoSerial(serial: string): boolean {
  const s = normalizeSerial(serial);
  if (!s) return false;

  // Loại channel UTRED kiểu A0A2001951U5-CH1
  if (s.includes("-CH")) return false;

  // Giữ LT5GEO: ví dụ serial kết thúc "157C"
  // (Nếu rule LT5GEO của bạn khác, sửa ở đây)
  if (s.endsWith("157C")) return true;

  return false;
}

/**
 * User endpoint:
 *  POST /api/lt5/readings
 */
export async function fetchLt5Readings(
  req: Lt5Request
): Promise<LtgeoReadingsEnvelope> {
  const res = await lt5UserApi.post<LtgeoReadingsEnvelope>("/readings", req);
  return res.data;
}

/**
 * Admin endpoint (Cách B):
 *  POST /api/admin/lt5/readings
 */
export async function fetchLt5ReadingsAdmin(
  req: Lt5Request
): Promise<LtgeoReadingsEnvelope> {
  const res = await lt5AdminApi.post<LtgeoReadingsEnvelope>("/readings", req);
  return res.data;
}

/**
 * User serial list:
 *  GET /api/lt5/serials
 */
export async function fetchMyLt5Serials(): Promise<string[]> {
  const res = await lt5UserApi.get<string[]>("/serials");
  const list = (res.data || [])
    .map(normalizeSerial)
    .filter(Boolean)
    .filter(isLt5GeoSerial);

  return Array.from(new Set(list)).sort();
}

/**
 * Admin serial list:
 *  GET /api/admin/lt5/serials
 */
export async function fetchAllLt5Serials(): Promise<string[]> {
  const res = await lt5AdminApi.get<string[]>("/serials");
  const list = (res.data || [])
    .map(normalizeSerial)
    .filter(Boolean)
    .filter(isLt5GeoSerial);

  return Array.from(new Set(list)).sort();
}