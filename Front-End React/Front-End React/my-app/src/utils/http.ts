import api from "../api/axios";
import { rateLimit } from "./rateLimit";

/** GET có retry 429 (tôn trọng Retry-After, tối đa 3 lần + jitter) */
export async function getWithRetry(url: string, config: any, maxAttempts = 3) {
  await rateLimit(url);
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await api.get(url, config);
    } catch (err: any) {
      const status = err?.response?.status;
      const ra = Number(err?.response?.headers?.["retry-after"] || 0);
      if (status === 429 && attempt + 1 < maxAttempts) {
        const waitMs = (ra > 0 ? ra * 1000 : 1000) + Math.floor(Math.random() * 250);
        await new Promise((r) => setTimeout(r, waitMs));
        attempt++;
        continue;
      }
      throw err;
    }
  }
}

export function userIdHeader() {
  const uid = localStorage.getItem("userId") || localStorage.getItem("uid") || "";
  return uid ? { "X-User-Id": uid } : {};
}