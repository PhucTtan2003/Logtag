// src/http.ts (giữ export & cấu trúc tương tự)
import axios, { AxiosError, AxiosHeaders, AxiosInstance } from "axios";
import { API_BASE } from "../config";
import { getUserId, getUserIdHeader } from "../utils/time";

// ---- Module-scope singletons ----
let singleton: { client: AxiosInstance; dedupGet: <T>(u: string, p?: any, s?: AbortSignal, o?: DedupOpts) => Promise<T> } | null = null;
const inflight = new Map<string, Promise<any>>();
const lastHitAt = new Map<string, number>();
const cache = new Map<string, { data: any; expires: number }>();

type DedupOpts = { cacheMs?: number; cooldownMs?: number };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function parseRetryAfter(h?: string | number): number {
  if (!h) return 0;
  if (typeof h === "number") return Math.max(0, h) * 1000;
  const n = Number(h);
  if (!Number.isNaN(n)) return Math.max(0, n) * 1000;
  const d = Date.parse(h);
  return Number.isNaN(d) ? 0 : Math.max(0, d - Date.now());
}

function key(url: string, params?: any) {
  return `GET:${url}:${JSON.stringify(params || {})}`;
}
function route(url: string) {
  const i = url.indexOf("?");
  return i >= 0 ? url.slice(0, i) : url;
}

export function createHttp() {
  if (singleton) return singleton; // <-- luôn trả về cùng 1 instance

  const client = axios.create({
    baseURL: API_BASE || undefined,
    withCredentials: true,
  });

  // Request interceptor
  client.interceptors.request.use((config) => {
    if (!(config.headers instanceof AxiosHeaders)) {
      config.headers = new AxiosHeaders(config.headers);
    }
    const h = config.headers as AxiosHeaders;
    h.set("Content-Type", "application/json");
    const uid = getUserId();
    if (uid) h.set("X-User-Id", uid);
    (config as any).__retryCount = (config as any).__retryCount ?? 0;
    return config;
  });

  // Response interceptor với backoff tử tế
  client.interceptors.response.use(
    (r) => r,
    async (err: AxiosError) => {
      const cfg: any = err.config || {};
      const status = err.response?.status;
      if ((status === 429 || status === 503) && (cfg.__retryCount ?? 0) < 5) {
        cfg.__retryCount = (cfg.__retryCount ?? 0) + 1;

        const ra = err.response?.headers?.["retry-after"];
        const retryAfterMs = parseRetryAfter(Array.isArray(ra) ? ra[0] : (ra as any));
        // expo backoff: 800ms, 1600, 3200, ... capped 30s
        const expo = Math.min(30_000, Math.floor(800 * 2 ** (cfg.__retryCount - 1)));
        const jitter = Math.floor(Math.random() * 500);
        const delay = Math.max(retryAfterMs, expo) + jitter;

        await sleep(delay);
        cfg.headers = { ...(cfg.headers || {}), ...getUserIdHeader() };
        return client(cfg);
      }
      throw err;
    }
  );

  // dedup + throttle + cache
  async function dedupGet<T = any>(
    url: string,
    params?: any,
    signal?: AbortSignal,
    opts?: DedupOpts
  ): Promise<T> {
    const cacheMs = opts?.cacheMs ?? 0;
    const cooldownMs = opts?.cooldownMs ?? 0;
    const k = key(url, params);

    // serve cache nếu còn hạn
    if (cacheMs > 0) {
      const c = cache.get(k);
      if (c && c.expires > Date.now()) return c.data as T;
    }

    // throttle theo route (tránh spam cùng endpoint)
    if (cooldownMs > 0) {
      const rk = route(url);
      const last = lastHitAt.get(rk) ?? 0;
      const wait = last + cooldownMs - Date.now();
      if (wait > 0) await sleep(wait);
    }

    if (inflight.has(k)) return inflight.get(k)!;

    const p = client
      .get<T>(url, { params, signal })
      .then(res => {
        lastHitAt.set(route(url), Date.now());
        if (cacheMs > 0) cache.set(k, { data: res.data, expires: Date.now() + cacheMs });
        return res.data;
      })
      .finally(() => inflight.delete(k));

    inflight.set(k, p);
    return p;
  }

  singleton = { client, dedupGet };
  return singleton;
}