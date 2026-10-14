import React, { useState } from "react";
import Login from "../../pages/Login";
import { useEffect } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import "../../styles/TheNews.css";


const devices = [
  {
    id: "lt5geo",
    name: "LT5GEO",
    tagline: "Khả năng hiển thị toàn cầu theo thời gian thực",
    link: "https://congnghethongminh.com.vn/lt5geo-thiet-bi-ghi-nhiet-do-do-am",
    description:
      "LogTag® LT5GEO là thiết bị ghi dữ liệu di động thời gian thực được thiết kế để tự động tải dữ liệu nhiệt độ, độ ẩm, ánh sáng và va chạm lên nền tảng đám mây LogTag® Online. Với dung lượng lưu trữ lên đến 16.320 bản ghi, thiết bị này cho phép giám sát liên tục và truy cập tức thời vào các điều kiện vận chuyển quan trọng trên toàn thế giới.",
    features: [
      "4 cảm biến: Nhiệt độ, Độ ẩm, Ánh sáng, Va đập",
      "Tải dữ liệu di động theo thời gian thực",
      "Đèn LED báo trạng thái (Cảnh báo / OK)",
      "Bộ nhớ lưu trữ tối đa 16.320 nhật ký",
      "Thao tác chỉ với một nút bấm",
      "Tích hợp đám mây thông qua LogTag Online",
    ],
    image: "/Pictures/LT5GEO2.png",
    colorClass: "blue-glow",
    details:
      "LT5GEO cung cấp khả năng hiển thị đầy đủ về môi trường trong quá trình vận chuyển, giúp doanh nghiệp phát hiện rủi ro sớm và đảm bảo tuân thủ các quy định trong toàn bộ chuỗi cung ứng toàn cầu.",
  },
  {
    id: "utred30",
    name: "UTRED 30 - WiFi",
    tagline: "Giám sát chính xác hai kênh",
    link: "https://congnghethongminh.com.vn/utred30-wifi-dc-thiet-bi-ghi-du-lieu-wifi-2-kenh",
    description:
      "UTRED30-WiFi là thiết bị ghi dữ liệu nhiệt độ hai kênh tự động tải dữ liệu thời gian thực qua WiFi lên LogTag® Online. Thiết bị có màn hình lớn hiển thị giá trị hiện tại, giá trị tối thiểu/tối đa, trạng thái cảnh báo và dữ liệu lịch sử lên đến 30 ngày.",
    features: [
      "Giám sát nhiệt độ hai kênh",
      "Kết nối WiFi thời gian thực",
      "Màn hình lớn hiển thị số liệu thống kê",
      "Theo dõi nhiệt độ tối thiểu/tối đa + cảnh báo",
      "Truy cập dữ liệu qua USB + đám mây",
      "Hỗ trợ đầu dò ngoài",
    ],
    image: "/Pictures/UTRED30-Wifi-DC.png",
    colorClass: "blue-glow",
    details:
      "UTRED30-WiFi kết hợp độ chính xác và khả năng kết nối, lý tưởng cho ngành dược phẩm, phòng thí nghiệm và môi trường kho lạnh.",
  },
  {
    id: "utrel30",
    name: "UTREL 30 - WiFi",
    tagline: "Chuyên gia nhiệt độ thấp",
    link: "https://congnghethongminh.com.vn/utrel30-wifi-dc-thiet-bi-ghi-nhiet-do-wifi-2-kenh",
    description:
      "UTREL30-WiFi được thiết kế cho môi trường nhiệt độ cực thấp, cung cấp khả năng giám sát hai kênh với kết nối không dây. Thiết bị ghi lại tối đa 16.065 lần đo và cung cấp bản tóm tắt cảnh báo chi tiết trong khoảng thời gian 30 ngày.",
    features: [
      "Giám sát nhiệt độ cực thấp",
      "Đầu dò ngoài hai kênh",
      "Kết nối WiFi + USB",
      "Tóm tắt cảnh báo 30 ngày",
      "Màn hình LCD lớn",
      "Pin + nguồn dự phòng",
    ],
    image: "/Pictures/UTREL30-Wifi-Dc.png",
    colorClass: "green-glow",
    details:
      "Được thiết kế cho các ứng dụng chuỗi cung ứng lạnh khắc nghiệt, UTREL30-WiFi đảm bảo giám sát đáng tin cậy trong các môi trường đòi hỏi cao như kho bảo quản vắc-xin và hậu cần đông lạnh sâu.",
  },
];

export default function App() {
  
  const [menuOpen, setMenuOpen] = useState(false);
  const [specOpen, setSpecOpen] = useState(false);
    const location = useLocation();
    const [showLogin, setShowLogin] = useState(false);
      const navigate = useNavigate(); // ✅ đặt đúng chỗ

  useEffect(() => {
    if (location.hash) {
      const el = document.getElementById(location.hash.replace("#", ""));
      if (el) {
        setTimeout(() => {
          el.scrollIntoView({ behavior: "smooth" });
        }, 100);
      }
    }
  }, [location]);

  const handlePhoneContact = () => {
    const phone = "0938 733 596";
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    if (isMobile) {
      window.location.href = `tel:${phone}`;
    } else {
      alert(`Vui lòng liên hệ số điện thoại: ${phone}`);
    }
  };

  return (
    <div className="app">
      {/* NAV */}
      <nav className="navbar">
        <div className="container nav-inner">
          <div className="nav-left">
            <div className="brand">
              SMARTTECHCLOUD-
              <span className="brand-light">TIN TỨC</span>
            </div>

            <div className={`nav-links ${menuOpen ? "show" : ""}`}>
              <a href="https://www.congnghethongminh.com.vn/logtag">Sản Phẩm</a>
              <a href="https://www.congnghethongminh.com.vn/">Giải Pháp</a>
              <a href="https://www.congnghethongminh.com.vn/ho-tro-ky-thuat">Hỗ Trợ</a>
            </div>
          </div>

          <div className="nav-right">
            {/* ✅ FIX NÚT GET STARTED */}
            <button
              className="btn btn-primary"
              onClick={() => setShowLogin(true)}
            >
              Đăng Nhập
            </button>

            <button
              className="menu-btn"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Toggle menu"
            >
              ☰
            </button>
          </div>
        </div>
      </nav>

      <main>
        {/* HERO */}
        <section className={`hero ${specOpen ? "hero-dropdown-open" : ""}`}>
          <div className="hero-glow hero-glow-right"></div>
          <div className="hero-glow hero-glow-left"></div>

          <div className="container hero-grid">
            <div className="hero-text">
              <span className="badge dark-badge">Báo Cáo Ngành Năm 2026</span>
              <br></br>
<br></br>
              <h1>
                KỸ NGUYÊN MỚI CỦA <br />
                <span className="highlight">TRÍ TUỆ</span> CHUỖI CUNG ỨNG LẠNH
              </h1>

              <p>
                LogTag giới thiệu thế hệ thiết bị giám sát mới
                ược thiết kế để thu hẹp khoảng cách giữa dữ liệu cục bộ
                và khả năng hiển thị toàn cầu.
              </p>

              <div className="hero-actions">
                <button
                  className="btn btn-gradient"
                  onClick={() =>
                    window.open("https://smarttechcloud.net/", "_blank")
                  }
                >
                  🚀 Kết Nối Với Chúng Tôi
                </button>

                <div
                  className="dropdown"
                  onMouseEnter={() => setSpecOpen(true)}
                  onMouseLeave={() => setSpecOpen(false)}
                >
                  <button
                    className="btn btn-light"
                    onClick={() => setSpecOpen(!specOpen)}
                  >
                    Thông Tin Sản Phẩm Khác +
                  </button>

                  <div className={`dropdown-menu ${specOpen ? "open" : ""}`}>
                    <button
                      onClick={() =>
                        window.open(
                          "https://congnghethongminh.com.vn/lt5geo-thiet-bi-ghi-nhiet-do-do-am",
                          "_blank"
                        )
                      }
                    >
                      📡 LT5GEO
                    </button>
                    <button
                      onClick={() =>
                        window.open(
                          "https://congnghethongminh.com.vn/utred30-wifi-dc-thiet-bi-ghi-du-lieu-wifi-2-kenh",
                          "_blank"
                        )
                      }
                    >
                      🌡️ UTRED 30 - WiFi
                    </button>
                    <button
                      onClick={() =>
                        window.open(
                          "https://congnghethongminh.com.vn/utrel30-wifi-dc-thiet-bi-ghi-nhiet-do-wifi-2-kenh",
                          "_blank"
                        )
                      }
                    >
                      ❄️ UTREL 30 - WiFi
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="hero-image-wrap">
              <img
                src="/Pictures/ttt.png"
                alt="Cold chain devices"
                className="hero-image"
              />
              <div className="hero-image-glow"></div>
            </div>
          </div>
        </section>

        {/* ARTICLE */}
        <section className="article-section">
          <div className="container article-grid">
            {/* SIDEBAR */}
            <aside className="sidebar">
              <div className="sidebar-sticky">
                <div className="meta-block">
                  <h3>Được Viết Bởi</h3>
                  <div className="author-box">
                    <img
                      src="/Pictures/lizard.png"
                      alt="author"
                      className="author-avatar"
                    />
                    <div>
                      <p className="author-name">Smarttech Jr.</p>
                      <p className="author-role">Nhà Phân Tích Chuỗi Cung Ứng Lạnh</p>
                    </div>
                  </div>
                </div>

                <div className="meta-block">
                  <h3>Đã Đăng</h3>
                  <p className="meta-text">🕒 08/04/2026</p>
                </div>

                <div className="meta-block">
                  <h3>Từ Khóa Chủ Đề</h3>
                  <div className="topic-list">
                    {["IoT", "Logistics", "Pharma", "WiFi", "LTE"].map(
                      (topic) => (
                        <span key={topic} className="badge light-badge">
                          {topic}
                        </span>
                      )
                    )}
                  </div>
                </div>
              </div>
            </aside>

            {/* CONTENT */}
            <div className="article-content">
              <blockquote className="quote">
                "Trong một thế giới ngày càng kết nối, việc giám sát hàng hóa nhạy cảm theo thời gian thực không còn là điều xa xỉ nữa mà đã trở thành yêu cầu thiết yếu để tuân thủ quy định và nâng cao hiệu quả hoạt động."
              </blockquote>

              <p className="intro-text">
                Ngành công nghiệp chuỗi cung ứng lạnh đang trải qua một sự chuyển đổi lớn. Trong nhiều năm, các thiết bị ghi dữ liệu truyền thống hoạt động như những công cụ thụ động—ghi lại thông tin chỉ có thể truy cập được sau khi lô hàng đã hoàn tất. Sự chậm trễ này thường hạn chế khả năng ứng phó với rủi ro trong thời gian thực.
                <br />
                <br />
                Ngày nay, mô hình đó đang thay đổi. LogTag đang dẫn đầu sự phát triển này bằng cách giới thiệu thế hệ thiết bị giám sát thông minh mới. Với khả năng kết nối được nâng cao và truy cập dữ liệu theo thời gian thực, các giải pháp này đang định nghĩa lại cách các doanh nghiệp quản lý, theo dõi và bảo vệ các sản phẩm nhạy cảm với nhiệt độ trong toàn bộ chuỗi cung ứng toàn cầu.
              </p>

              <div className="device-list" id="products">
                {devices.map((device, index) => (
                  <div key={device.id} className="device-block">
                    <div
                      className={`device-grid ${
                        index % 2 === 1 ? "reverse" : ""
                      }`}
                    >
                      <div className="device-image-wrap">
                        <div
                          className={`device-image-glow ${device.colorClass}`}
                        ></div>
                        <img
                          src={device.image}
                          alt={device.name}
                          className="device-image"
                        />
                        <span className="badge floating-badge">
                          Thiết Bị Nổi Bật
                        </span>
                      </div>

                      <div className="device-info">
                        <h2>{device.name}</h2>
                        <p className="device-tagline">{device.tagline}</p>
                        <p className="device-description">
                          {device.description}
                        </p>

                        <div className="feature-grid">
                          {device.features.map((feature) => (
                            <div key={feature} className="feature-item">
                              <span className="feature-icon">✔</span>
                              <span>{feature}</span>
                            </div>
                          ))}
                        </div>

                        <a
                          href={device.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="learn-more"
                        >
                          Tìm Hiểu Thêm Về {device.name} →
                        </a>
                      </div>
                    </div>

                    <div className="expert-box">
                      <h4>🌍 Thông tin chuyên gia</h4>
                      <p>"{device.details}"</p>
                    </div>
                  </div>
                ))}
              </div>

              <hr className="section-line" />

              <div className="cta-box">
                <div className="cta-content">
                  <h2>Sẵn Sàng Để Nâng Cấp Hệ Thống Giám Sát Của Bạn?</h2>
                  <p>
                    Hãy tham gia cùng hàng ngàn tổ chức trên toàn thế giới tin tưởng LogTag
                    cho các nhu cầu chuỗi cung ứng lạnh quan trọng của họ.
                  </p>

                  <div className="cta-actions">
                    <button
                      className="btn btn-primary"
                      onClick={handlePhoneContact}
                    >
                      Liên Hệ Với Sales
                    </button>
                    <button
                      className="btn btn-outline"
                      onClick={() => window.open('https://congnghethongminh.com.vn/toi-uu-bao-ve-chuoi-lanh-thiet-bi-giam-sat-nhiet-do-hai-kenh-chuan-quoc-te-1768878829', '_blank')}
                    >
                      Thông Tin Thêm Về Bài Viết
                    </button>
                  </div>
                </div>

                <div className="cta-glow"></div>
              </div>
            </div>
          </div>
        </section>
      </main>
{showLogin && (
  <Login
    isPopup={true}
    onClose={() => setShowLogin(false)}
  />
)}
      
    </div>
  );
}
