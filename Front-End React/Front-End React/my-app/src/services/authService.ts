import axios from "axios";

const API_BASE = "https://localhost:444300/"; // URL backend
const API_URL = '';

axios.defaults.withCredentials = true;

export async function checkAuth() {
  try {
    const res = await axios.get(`${API_BASE}/api/auth/me`);
    return res.data; // giả sử server trả về: { name, email, role }
  } catch (error) {
    return null;
  }
}
axios.defaults.withCredentials = true;

export async function checkadmin() {
  try {
    const res = await axios.get(`${API_URL}/api/admin`);
    return res.data; // giả sử server trả về: { name, email, role }
  } catch (error) {
    return null;
  }
}
