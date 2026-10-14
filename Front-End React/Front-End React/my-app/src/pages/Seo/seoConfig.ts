export const SEO_CONFIG = {
  siteName: "Smarttech Cloud",
  baseUrl: "https://smarttechcloud.net",
  defaultTitle: "Smarttech Cloud | Giám sát nhiệt độ & hành trình realtime",
  defaultDescription:
    "Nền tảng Smarttech Cloud giúp giám sát nhiệt độ, độ ẩm và hành trình, cảnh báo realtime và quản lý dữ liệu tập trung.",
  defaultImage: "/Pictures/logo.png",
  locale: "vi_VN",
} as const;

export function toAbsoluteUrl(pathOrUrl?: string): string | undefined {
  if (!pathOrUrl) return undefined;

  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  const normalizedPath = pathOrUrl.startsWith("/")
    ? pathOrUrl
    : `/${pathOrUrl}`;

  return `${SEO_CONFIG.baseUrl}${normalizedPath}`;
}
