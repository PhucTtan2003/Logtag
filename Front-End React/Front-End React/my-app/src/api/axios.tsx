import axios, {
  AxiosError,
  AxiosHeaders,
  InternalAxiosRequestConfig,
} from "axios";

const ENV_BASE_URL = process.env.REACT_APP_API_BASE_URL?.trim();
const FALLBACK_BASE_URL = "https://localhost:44300";
const BASE_URL = (ENV_BASE_URL || FALLBACK_BASE_URL).replace(/\/+$/, "");

console.info("[API] Base URL:", BASE_URL);

const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  timeout: 60_000,
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    config.withCredentials = true;

    if (!(config.headers instanceof AxiosHeaders)) {
      config.headers = new AxiosHeaders(config.headers);
    }

    const accountId =
      localStorage.getItem("accountId") || localStorage.getItem("uid");

    if (accountId) {
      config.headers.set("accountId", accountId);
      config.headers.set("X-User-Id", accountId);
    } else {
      config.headers.delete("accountId");
      config.headers.delete("X-User-Id");
    }

    return config;
  },
  (error: AxiosError) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const status = error.response?.status;
    const requestUrl = String(error.config?.url || "");
    const path = requestUrl.split("?")[0].replace(/\/+$/, "").toLowerCase();


    const isAuthEndpoint =
      path.endsWith("/api/auth/me") ||
      path.endsWith("/api/auth/login") ||
      path.endsWith("/api/auth/logout");

    if (status === 401 && !isAuthEndpoint) {
      window.dispatchEvent(
        new CustomEvent("auth:unauthorized", {
          detail: { requestUrl },
        })
      );
    }

    return Promise.reject(error);
  }
);

export function absUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${BASE_URL}${normalizedPath}`;
}

export { BASE_URL };
export default api;
