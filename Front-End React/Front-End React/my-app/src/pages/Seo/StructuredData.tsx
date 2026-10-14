import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const SCHEMA_ELEMENT_ID = "smarttech-home-structured-data";

const HOME_STRUCTURED_DATA = {
  "@context": "https://schema.org",

  "@graph": [
    // =====================================================
    // ORGANIZATION
    // =====================================================
    {
      "@type": "Organization",

      "@id": "https://smarttechcloud.net/#organization",

      name: "SmartTech Vietnam",

      alternateName: "SMARTTECH",

      url: "https://smarttechcloud.net/",

      logo: {
        "@type": "ImageObject",

        url: "https://smarttechcloud.net/Pictures/logo.png"
      },

      email: "sales@smarttechco.com.vn",

      telephone: "028-7300-3603",

      address: {
        "@type": "PostalAddress",

        streetAddress: "200/1 Phan Đăng Lưu, Q.Phú Nhuận",

        addressLocality: "Ho Chi Minh City",

        addressCountry: "VN"
      },

      sameAs: [
        "https://congnghethongminh.com.vn/",
        "https://www.facebook.com/Smarttechnologyandtradingco.Ltd",
        "https://www.youtube.com/@CONGNGHETHONGMINH_SMARTTECH"
      ]
    },

    // =====================================================
    // WEBSITE
    // =====================================================
    {
      "@type": "WebSite",

      "@id": "https://smarttechcloud.net/#website",

      url: "https://smarttechcloud.net/",

      name: "Smarttech Cloud",

      description:
        "Nền tảng Smarttech Cloud giúp giám sát nhiệt độ, độ ẩm và hành trình, cảnh báo realtime và quản lý dữ liệu tập trung.",

      inLanguage: "vi-VN",

      publisher: {
        "@id": "https://smarttechcloud.net/#organization"
      }
    },

    // =====================================================
    // SOFTWARE APPLICATION
    // =====================================================
    {
      "@type": "SoftwareApplication",

      "@id": "https://smarttechcloud.net/#software",

      name: "Smarttech Cloud",

      url: "https://smarttechcloud.net/",

      applicationCategory: "BusinessApplication",

      applicationSubCategory:
        "Temperature Monitoring and Cold Chain Monitoring",

      operatingSystem: "Web",

      inLanguage: "vi-VN",

      description:
        "Nền tảng giám sát nhiệt độ, độ ẩm và hành trình theo thời gian thực, hỗ trợ cảnh báo, quản lý thiết bị tập trung, lịch sử dữ liệu, biểu đồ và báo cáo.",

      provider: {
        "@id": "https://smarttechcloud.net/#organization"
      },

      publisher: {
        "@id": "https://smarttechcloud.net/#organization"
      },

      featureList: [
        "Giám sát nhiệt độ và trạng thái thiết bị liên tục",
        "Theo dõi dữ liệu nhiệt độ và độ ẩm",
        "Cảnh báo khi dữ liệu vượt ngưỡng",
        "Quản lý thiết bị tập trung trên dashboard",
        "Theo dõi lịch sử dữ liệu và biểu đồ",
        "Xuất dữ liệu và báo cáo",
        "Theo dõi hành trình vận chuyển với LT5GEO",
        "Hỗ trợ UTRED30-WiFi",
        "Hỗ trợ UTREL30-WiFi",
        "Hỗ trợ LT5GEO"
      ]
    }
  ]
};


/**
 * StructuredData
 *
 * Hiện tại:
 * - Chỉ homepage "/" được gắn structured data.
 *
 * Sau này có thể mở rộng:
 * - /news/...         -> NewsArticle
 * - /thiet-bi/...     -> Product
 * - /giai-phap/...    -> Service
 */
const StructuredData = () => {
  const location = useLocation();

  useEffect(() => {
    /*
     * Xóa schema cũ nếu React Router chuyển route.
     */
    const oldElement =
      document.getElementById(SCHEMA_ELEMENT_ID);

    if (oldElement) {
      oldElement.remove();
    }

    /*
     * Hiện tại chỉ homepage có schema này.
     */
    if (location.pathname !== "/") {
      return;
    }

    /*
     * Tạo:
     *
     * <script type="application/ld+json">
     * ...
     * </script>
     */
    const script =
      document.createElement("script");

    script.id = SCHEMA_ELEMENT_ID;

    script.type =
      "application/ld+json";

    /*
     * replace < để tránh trường hợp JSON
     * chứa chuỗi gây đóng script ngoài ý muốn.
     */
    script.textContent =
      JSON.stringify(
        HOME_STRUCTURED_DATA
      ).replace(
        /</g,
        "\\u003c"
      );

    /*
     * Đặt schema trong <head>.
     */
    document.head.appendChild(script);

    /*
     * Khi rời homepage:
     * xóa schema homepage.
     */
    return () => {
      const currentElement =
        document.getElementById(
          SCHEMA_ELEMENT_ID
        );

      if (currentElement) {
        currentElement.remove();
      }
    };
  }, [location.pathname]);

  return null;
};

export default StructuredData;