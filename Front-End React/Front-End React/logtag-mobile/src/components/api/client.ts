import axios from "axios";
import { Platform } from "react-native";

const LAN_IP = "192.168.1.18";

// Web trên máy tính vẫn dùng localhost.
// Điện thoại Expo Go dùng IP LAN của máy tính.
export const API_BASE_URL =
  Platform.OS === "web"
    ? "https://localhost:44300"
    : `http://${LAN_IP}:5000`;

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});