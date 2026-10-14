import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../../api/axios";
import "../../styles/HomePage.css";
import Login from "../../pages/Login";


export default function HomePage() {
  const navigate = useNavigate();
  const [showLogin, setShowLogin] = useState(false);
  const [showContact, setShowContact] = useState(false);

  const contactPhoneDisplay = "1900 633 603";
  const contactPhoneTel = "1900633603";


  const getDashboardPath = (role: string, redirectTo?: string) => {
    if (redirectTo && redirectTo.startsWith("/")) return redirectTo;

    const r = String(role || "").toLowerCase();

    if (r === "admin") return "/admin";
    if (r === "employee") return "/employee";
    if (r === "user") return "/user";

    return "/user";
  };

  const handleLoginClick = async () => {
    try {
      const res = await api.get("/api/auth/me", {
        withCredentials: true,
      });

      const data = res.data;

      if (data?.authenticated === false) {
        setShowLogin(true);
        return;
      }

      const role =
        data?.roleName ||
        data?.role ||
        data?.user?.roleName ||
        data?.user?.role ||
        "";

      if (role) {
        navigate(getDashboardPath(role, data?.redirectTo), {
          replace: true,
        });
        return;
      }

      setShowLogin(true);
    } catch {
      setShowLogin(true);
    }
  };


  const handleContactClick = () => {
    const isMobile =
      /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|Mobile/i.test(
        navigator.userAgent
      );

    if (isMobile) {
      window.location.href = `tel:${contactPhoneTel}`;
      return;
    }

    setShowContact(true);
  };

  return (
    <div className="homepage">
      {/* NAVBAR */}
      <nav className="navbar">
        <div className="nav-container">
          <div className="logo">
            <span>SMARTTECHCLOUD</span>
          </div>

          <div className="nav-menu">
            <a
              href="https://www.congnghethongminh.com.vn/logtag"
              target="_blank"
              rel="noopener noreferrer"
            >
              Sản phẩm
            </a>

            <a href="#system-flow">Hệ thống</a>

            <Link to="/news">Tin tức</Link>

            <button
              type="button"
              className="nav-link-button"
              onClick={handleContactClick}
            >
              Liên hệ
            </button>

            <button
              type="button"
              className="btn-white"
              onClick={handleLoginClick}
            >
              Đăng nhập hệ thống
            </button>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="hero">
        <div className="hero-bg-orb hero-orb-1"></div>
        <div className="hero-bg-orb hero-orb-2"></div>

        <div className="hero-content section-shell">
          <div className="hero-left">
            <div className="hero-badge">SMARTTECH CLOUD PLATFORM</div>

            <h1>
              Giám sát nhiệt độ & hành trình
              <br />
              <span>Realtime trên Smarttech Cloud</span>
            </h1>

            <p>
              Kết nối UTRED30-WiFi, UTREL30-WiFi và LT5GEO trên một nền tảng
              tập trung. Theo dõi dữ liệu liên tục, nhận cảnh báo tức thì và
              quản lý toàn bộ thiết bị trên một dashboard duy nhất.
            </p>

            <div className="hero-actions">
              <button
                type="button"
                className="btn-primary"
                onClick={handleLoginClick}
              >
                Truy cập hệ thống
              </button>

              <a className="btn-secondary" href="#products">
                Xem thiết bị nổi bật
              </a>
            </div>

            <div className="hero-stats">
              <div className="stat-card">
                <strong>24/7</strong>
                <span>Giám sát liên tục</span>
              </div>

              <div className="stat-card">
                <strong>3 thiết bị</strong>
                <span>Tích hợp nổi bật</span>
              </div>

              <div className="stat-card">
                <strong>Cloud</strong>
                <span>Quản lý tập trung</span>
              </div>
            </div>
          </div>

          <div className="hero-right triple">
            <div className="hero-device-focus">
              <img src="/Pictures/UTRED30-WiFi.png" alt="UTRED30-WiFi" />
              <span className="device-chip">WiFi Logger</span>
              <h3>UTRED30-WiFi</h3>
            </div>

            <div className="hero-device-focus highlight">
              <img src="/Pictures/UTREL30-WiFi.png" alt="UTREL30-WiFi" />
              <span className="device-chip">Environment</span>
              <h3>UTREL30-WiFi</h3>
            </div>

            <div className="hero-device-focus">
              <img src="/Pictures/LT5Geoweb.png" alt="LT5GEO" />
              <span className="device-chip">Tracking</span>
              <h3>LT5GEO</h3>
            </div>
          </div>
        </div>
      </section>

      {/* FLOW */}
      <section id="system-flow" className="section-shell section-block">
        <div className="section-heading center">
          <span className="eyebrow">SMARTTECH CLOUD</span>
          <h2>Hệ thống hoạt động như thế nào?</h2>
          <p>
            Từ thiết bị ghi nhận dữ liệu đến cloud và dashboard cảnh báo, mọi
            thông tin được xử lý tập trung trên cùng một hệ thống.
          </p>
        </div>

        <div className="flow-modern">
          <div className="flow-box">
            <div className="flow-icon">📡</div>
            <h3>Thiết bị</h3>
            <p>
              UTRED30-WiFi, UTREL30-WiFi và LT5GEO ghi nhận nhiệt độ, trạng
              thái vận hành, cảnh báo và dữ liệu hành trình tùy theo từng dòng
              thiết bị.
            </p>
          </div>

          <div className="flow-line"></div>

          <div className="flow-box">
            <div className="flow-icon">☁️</div>
            <h3>Cloud</h3>
            <p>
              Dữ liệu được đồng bộ về LogTag Online / Smarttech Cloud để lưu
              trữ, theo dõi từ xa và xử lý cảnh báo.
            </p>
          </div>

          <div className="flow-line"></div>

          <div className="flow-box highlight">
            <div className="flow-icon">📊</div>
            <h3>Dashboard</h3>
            <p>
              Theo dõi biểu đồ, cảnh báo, lịch sử dữ liệu, hành trình vận
              chuyển và báo cáo mọi lúc mọi nơi.
            </p>
          </div>
        </div>
      </section>

      {/* PRODUCTS */}
      <section id="products" className="section-shell section-block">
        <div className="section-heading center">
          <span className="eyebrow">FLAGSHIP DEVICES</span>
          <h2>Thiết bị nổi bật</h2>
          <p>
            Ba thiết bị chủ lực cho giám sát nhiệt độ cố định, kho lạnh và vận
            chuyển lạnh trên nền tảng Smarttech Cloud.
          </p>
        </div>

        <div className="product-grid">
          <div className="product-card">
            <div className="product-top">
              <span className="product-badge blue">Y tế / Vaccine</span>
              <h3>UTRED30-WiFi</h3>
              <p className="product-desc">
                Thiết bị ghi nhiệt độ WiFi phù hợp tủ vaccine, phòng lab và khu
                vực cần giám sát nhiệt độ ổn định, có cảnh báo ngưỡng và đồng bộ
                dữ liệu lên LogTag Online.
              </p>
            </div>

            <ul className="product-list">
              <li>Ghi dữ liệu nhiệt độ theo chu kỳ cấu hình</li>
              <li>Cài ngưỡng cảnh báo cao / thấp</li>
              <li>Kết nối WiFi và LogTag Online</li>
              <li>Nguồn sạc/USB kèm pin AAA dự phòng</li>
            </ul>
          </div>

          <div className="product-card featured">
            <div className="product-top">
              <span className="product-badge emerald">
                Kho lạnh / Tủ bảo quản
              </span>
              <h3>UTREL30-WiFi</h3>
              <p className="product-desc">
                Thiết bị giám sát nhiệt độ môi trường sử dụng đầu dò ngoài ST10,
                phù hợp kho lạnh, tủ lạnh, tủ đông và khu bảo quản cần theo dõi
                liên tục.
              </p>
            </div>

            <ul className="product-list">
              <li>Đầu dò ngoài ST10</li>
              <li>USB là nguồn cấp chính</li>
              <li>2 pin AAA dự phòng khi mất điện</li>
              <li>Đồng bộ dữ liệu qua WiFi lên LogTag Online</li>
            </ul>
          </div>

          <div className="product-card">
            <div className="product-top">
              <span className="product-badge orange">Vận chuyển / GPS</span>
              <h3>LT5GEO</h3>
              <p className="product-desc">
                Thiết bị theo dõi hành trình vận chuyển lạnh, tự tải dữ liệu lên
                LogTag Online qua kết nối di động và ghi nhận nhiều loại dữ liệu
                môi trường trong chuyến hàng.
              </p>
            </div>

            <ul className="product-list">
              <li>Theo dõi nhiệt độ trong hành trình</li>
              <li>Ghi thêm độ ẩm, ánh sáng và va đập shock</li>
              <li>Có dữ liệu định vị / shipment tracking</li>
              <li>Pin NiMH sạc lại qua USB-C</li>
            </ul>
          </div>
        </div>
      </section>

      {/* COMPARISON */}
      <section id="system" className="section-shell section-block comparison-wrap">
        <div className="comparison-panel simple-comparison">
          <div className="comparison-left">
            <span className="eyebrow">DEVICE COMPARISON</span>
            <h2>So sánh thiết bị</h2>
            <p>
              Bảng dưới đây giúp phân biệt nhanh 3 thiết bị theo mục đích sử
              dụng thực tế: giám sát tủ/kho, theo dõi vận chuyển và khả năng
              cảnh báo trên Cloud.
            </p>

            <div className="compare-points">
              <div className="compare-point">
                <strong>UTRED30-WiFi</strong>
                <span>
                  Phù hợp giám sát nhiệt độ tủ vaccine, y tế, phòng lab hoặc khu
                  vực cần ghi dữ liệu định kỳ và cảnh báo ngưỡng.
                </span>
              </div>

              <div className="compare-point">
                <strong>UTREL30-WiFi</strong>
                <span>
                  Phù hợp kho lạnh, tủ lạnh, tủ đông và khu bảo quản dùng đầu dò
                  ngoài.
                </span>
              </div>

              <div className="compare-point">
                <strong>LT5GEO</strong>
                <span>
                  Phù hợp vận chuyển lạnh, theo dõi hành trình, vị trí và dữ liệu
                  môi trường.
                </span>
              </div>
            </div>
          </div>

          <div className="comparison-right">
            <div className="device-table-card">
              <table className="device-table">
                <thead>
                  <tr>
                    <th>Tiêu chí</th>
                    <th>UTRED30-WiFi</th>
                    <th>UTREL30-WiFi</th>
                    <th>LT5GEO</th>
                  </tr>
                </thead>

                <tbody>
                  <tr>
                    <td>Mục đích chính</td>
                    <td>Tủ vaccine / y tế</td>
                    <td>Kho lạnh / tủ bảo quản</td>
                    <td>Vận chuyển lạnh</td>
                  </tr>

                  <tr>
                    <td>Ghi nhiệt độ</td>
                    <td>
                      <span className="yes">✓ Có</span>
                    </td>
                    <td>
                      <span className="yes">✓ Có</span>
                    </td>
                    <td>
                      <span className="yes">✓ Có</span>
                    </td>
                  </tr>

                  <tr>
                    <td>Kết nối Cloud</td>
                    <td>WiFi / LogTag Online</td>
                    <td>WiFi / LogTag Online</td>
                    <td>Di động / LogTag Online</td>
                  </tr>

                  <tr>
                    <td>Theo dõi GPS / hành trình</td>
                    <td>
                      <span className="no">— Không</span>
                    </td>
                    <td>
                      <span className="no">— Không</span>
                    </td>
                    <td>
                      <span className="yes">✓ Có</span>
                    </td>
                  </tr>

                  <tr>
                    <td>Cảm biến mở rộng</td>
                    <td>Nhiệt độ</td>
                    <td>Nhiệt độ + đầu dò ST10</td>
                    <td>Nhiệt độ, độ ẩm, ánh sáng, va đập</td>
                  </tr>

                  <tr>
                    <td>Cảnh báo</td>
                    <td>Ngưỡng cao / thấp</td>
                    <td>Ngưỡng cao / thấp</td>
                    <td>Phone, SMS, WhatsApp, Email</td>
                  </tr>

                  <tr>
                    <td>Nguồn / Pin</td>
                    <td>USB / pin AAA dự phòng</td>
                    <td>USB / 2 pin AAA dự phòng</td>
                    <td>Pin sạc NiMH qua USB-C</td>
                  </tr>

                  <tr>
                    <td>Nên dùng khi</td>
                    <td>Cần giám sát nhiệt độ cố định</td>
                    <td>Cần theo dõi kho lạnh / tủ lạnh</td>
                    <td>Cần theo dõi chuyến hàng</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="section-shell section-block">
        <div className="section-heading center">
          <span className="eyebrow">PLATFORM FEATURES</span>
          <h2>Tính năng hệ thống</h2>
          <p>
            Nền tảng được xây dựng để theo dõi thiết bị realtime, đưa cảnh báo
            nhanh và hỗ trợ vận hành dễ dàng.
          </p>
        </div>

        <div className="feature-grid">
          <div className="feature">
            <div className="feature-icon">⚡</div>
            <h3>Giám sát liên tục</h3>
            <p>
              Theo dõi dữ liệu nhiệt độ và trạng thái thiết bị liên tục, hạn chế
              bỏ lỡ biến động trong quá trình vận hành.
            </p>
          </div>

          <div className="feature">
            <div className="feature-icon">🔔</div>
            <h3>Cảnh báo tức thì</h3>
            <p>
              Nhận cảnh báo khi vượt ngưỡng nhiệt độ hoặc phát sinh bất thường,
              hỗ trợ SMS, Email hoặc các hình thức cảnh báo tùy cấu hình.
            </p>
          </div>

          <div className="feature">
            <div className="feature-icon">🧩</div>
            <h3>Quản lý tập trung</h3>
            <p>
              Toàn bộ thiết bị được theo dõi trên một dashboard duy nhất, dễ
              kiểm tra, phân quyền và truy xuất dữ liệu.
            </p>
          </div>

          <div className="feature">
            <div className="feature-icon">📁</div>
            <h3>Báo cáo linh hoạt</h3>
            <p>
              Xuất dữ liệu, xem lịch sử, biểu đồ và báo cáo phục vụ đối chiếu,
              kiểm tra, lưu trữ hoặc audit.
            </p>
          </div>
        </div>
      </section>

      {/* USE CASE */}
      <section className="section-shell section-block">
        <div className="section-heading center">
          <span className="eyebrow">USE CASES</span>
          <h2>Ứng dụng thực tế</h2>
          <p>
            Từ y tế, kho lạnh đến vận chuyển, hệ thống giúp kiểm soát dữ liệu
            nhiệt độ liên tục và minh bạch hơn.
          </p>
        </div>

        <div className="usecase-grid">
          <div className="usecase-card">
            <div className="usecase-icon">💉</div>
            <h3>Vaccine & y tế</h3>
            <p>
              Đảm bảo chuỗi lạnh, tủ vaccine, phòng lab và điều kiện bảo quản
              luôn nằm trong ngưỡng kiểm soát.
            </p>
          </div>

          <div className="usecase-card">
            <div className="usecase-icon">🏭</div>
            <h3>Kho lạnh</h3>
            <p>
              Theo dõi nhiệt độ kho, tủ lạnh, tủ đông và khu bảo quản theo thời
              gian thực.
            </p>
          </div>

          <div className="usecase-card">
            <div className="usecase-icon">🚚</div>
            <h3>Vận chuyển lạnh</h3>
            <p>
              Kết hợp nhiệt độ, dữ liệu hành trình và cảnh báo để giám sát giao
              nhận minh bạch hơn.
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="section-shell">
        <div className="cta-panel">
          <div className="cta-copy">
            <span className="eyebrow light">SMARTTECH CLOUD</span>
            <h2>Kiểm soát nhiệt độ tốt hơn. Giảm rủi ro nhiều hơn.</h2>
            <p>
              Tập trung dữ liệu, cảnh báo nhanh và quản lý toàn bộ thiết bị nổi
              bật trên cùng một nền tảng.
            </p>
          </div>

          <div className="cta-actions">
            <button
              type="button"
              className="btn-white"
              onClick={handleLoginClick}
            >
              Đăng nhập hệ thống
            </button>

            <button
              type="button"
              className="btn-outline-white"
              onClick={handleContactClick}
            >
              Liên hệ Smarttech
            </button>
          </div>
        </div>
      </section>

      <br />
      <br />
      <br />

      {showLogin && (
        <Login isPopup={true} onClose={() => setShowLogin(false)} />
      )}

      {showContact && (
        <div className="contact-modal-overlay" onClick={() => setShowContact(false)}>
          <div
            className="contact-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="contact-modal-close"
              onClick={() => setShowContact(false)}
            >
              ×
            </button>

            <div className="contact-modal-icon">☎</div>

            <span className="eyebrow">SMARTTECH CONTACT</span>

            <h2>Liên hệ Smarttech</h2>

            <p>
              Cần tư vấn thiết bị giám sát nhiệt độ, kho lạnh hoặc vận chuyển?
              Vui lòng gọi tổng đài hỗ trợ bên dưới.
            </p>

            <a className="contact-phone" href={`tel:${contactPhoneTel}`}>
              {contactPhoneDisplay}
            </a>

            <div className="contact-modal-actions">
              <a className="contact-call-btn" href={`tel:${contactPhoneTel}`}>
                Gọi ngay
              </a>

              <button
                type="button"
                className="contact-close-btn"
                onClick={() => setShowContact(false)}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
