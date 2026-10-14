import { useLocation } from "react-router-dom";
import Seo from "./Seo";
import { SEO_CONFIG } from "./seoConfig";

type RouteSeo = {
  title: string;
  description: string;
  canonical: string;
  index: true;
};

const INDEXABLE_ROUTES: Record<string, RouteSeo> = {
  "/": {
    title: "Smarttech Cloud | Giám sát nhiệt độ & hành trình realtime",
    description:
      "Nền tảng Smarttech Cloud giúp giám sát nhiệt độ, độ ẩm và hành trình, cảnh báo realtime và quản lý dữ liệu tập trung.",
    canonical: "/",
    index: true,
  },
  "/news": {
    title: "Tin tức & kiến thức giám sát nhiệt độ | Smarttech Cloud",
    description:
      "Tin tức, hướng dẫn và kiến thức về giám sát nhiệt độ, độ ẩm, kho lạnh, vaccine và vận chuyển lạnh từ Smarttech Cloud.",
    canonical: "/news",
    index: true,
  },
};

function normalizePathname(pathname: string) {
  if (pathname === "/") return "/";
  return pathname.replace(/\/+$/, "") || "/";
}

export default function SeoRouteDefaults() {
  const location = useLocation();
  const pathname = normalizePathname(location.pathname);
  const publicSeo = INDEXABLE_ROUTES[pathname];

  if (publicSeo) {
    return <Seo {...publicSeo} />;
  }

  // An toàn mặc định: mọi route chưa được khai báo là public đều noindex.
  // Điều này đặc biệt phù hợp với /login, /admin, /user, /employee,
  // /export, /devices, /events... trong ứng dụng hiện tại.
  return (
    <Seo
      title={SEO_CONFIG.siteName}
      description={SEO_CONFIG.defaultDescription}
      index={false}
    />
  );
}
