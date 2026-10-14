import React, { useEffect, useMemo, useState } from "react";
import "../styles/FooterLayout.css";

const FacebookIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.7c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.4h-1.2c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.45 2.9h-2.35v7A10 10 0 0 0 22 12z" />
  </svg>
);

const YoutubeIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M23.5 7.1a3 3 0 0 0-2.1-2.1C19.6 4.5 12 4.5 12 4.5s-7.6 0-9.4.5a3 3 0 0 0-2.1 2.1A31 31 0 0 0 0 12a31 31 0 0 0 .5 4.9 3 3 0 0 0 2.1 2.1C4.4 19.5 12 19.5 12 19.5s7.6 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-4.9zM9.8 15.3V8.7l6.2 3.3-6.2 3.3z" />
  </svg>
);

const PinIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z" />
  </svg>
);

const PhoneIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1.2 1.2 0 0 1 1.3-.3c1 .4 2 .6 3 .7a1.2 1.2 0 0 1 1.1 1.2V20a1.2 1.2 0 0 1-1.2 1.2A18.6 18.6 0 0 1 3 6.2 1.2 1.2 0 0 1 4.2 5H7a1.2 1.2 0 0 1 1.2 1.1c.1 1 .3 2 .7 3 .1.5 0 1-.3 1.3l-2 2.4Z" />
  </svg>
);

const MailIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 4-8 5-8-5V6l8 5 8-5v2Z" />
  </svg>
);

const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M13.2 5.4a1 1 0 0 0-1.4 1.4l4.2 4.2H5a1 1 0 1 0 0 2h11l-4.2 4.2a1 1 0 1 0 1.4 1.4l5.9-5.9a1 1 0 0 0 0-1.4l-5.9-5.9Z" />
  </svg>
);

function useScrollShow(threshold = 300) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > threshold);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);

  return show;
}

type Partner = {
  name: string;
  logo: string;
  url: string;
};

const PARTNERS: Partner[] = [
  {
    name: "LogTag Online",
    logo: "/Cooperate/LogTagOnline.png",
    url: "https://logtag.com/",
  },
  {
    name: "SmartTech",
    logo: "/Pictures/logo.png",
    url: "https://congnghethongminh.com.vn/",
  },
];

const QUICK_LINKS = [
  { label: "Trang chủ", href: "https://congnghethongminh.com.vn/" },
  { label: "Về SmartTech", href: "https://congnghethongminh.com.vn/gioi-thieu" },
  { label: "Sản phẩm", href: "https://congnghethongminh.com.vn/san-pham" },
  { label: "Liên hệ", href: "https://congnghethongminh.com.vn/" },
  { label: "Chính sách bảo mật", href: "/policy" },
];

const CONTACTS = [
  {
    icon: <PinIcon />,
    label: "Địa chỉ",
    value: "200/1 Phan Đăng Lưu, Q.Phú Nhuận, HCMC",
  },
  {
    icon: <PhoneIcon />,
    label: "Hotline",
    value: "028-7300-3603 • 1900-633-603",
  },
  {
    icon: <MailIcon />,
    label: "Email",
    value: "sales@smarttechco.com.vn",
  },
];

const FooterLayout: React.FC = () => {
  const showTop = useScrollShow();
  const year = useMemo(() => new Date().getFullYear(), []);
  const youtubeId = "INcqElwWCzo";

  return (
    <footer className="stq-footer">
      <div className="stq-shell">
        <div className="stq-topline" />

        <section className="stq-main" aria-label="Thông tin SmartTech">
          <div className="stq-brand-block">
            <div className="stq-logo-wrap">
              <img src="/Pictures/logo.png" alt="SmartTech Logo" className="stq-logo" />
            </div>

            <div className="stq-brand-copy">
              <span className="stq-kicker">SmartTech Vietnam</span>
              <h2>Giám sát nhiệt độ, độ ẩm rõ ràng hơn mỗi ngày.</h2>
              <p>
                SMARTTECH cung cấp giải pháp công nghệ thông minh cho doanh nghiệp,
                hỗ trợ cảnh báo, dữ liệu và báo cáo vận hành một cách dễ theo dõi.
              </p>
            </div>
          </div>

          <div className="stq-contact-grid" aria-label="Thông tin liên hệ">
            {CONTACTS.map((item) => (
              <div className="stq-contact-card" key={item.label}>
                <span className="stq-contact-icon">{item.icon}</span>
                <div>
                  <small>{item.label}</small>
                  <b>{item.value}</b>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="stq-lower" aria-label="Nội dung footer">
          <div className="stq-panel stq-video-panel">
            <div className="stq-section-head">
              <span>Video giới thiệu</span>
              <h3>SmartTech Vietnam</h3>
            </div>
            <div className="stq-video">
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0`}
                title="SmartTech Vietnam"
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          </div>

          <div className="stq-panel stq-links-panel">
            <div className="stq-section-head">
              <span>Điều hướng</span>
              <h3>Liên kết nhanh</h3>
            </div>
            <nav className="stq-links" aria-label="Liên kết nhanh">
              {QUICK_LINKS.map((link) => (
                <a href={link.href} key={link.label}>
                  <span>{link.label}</span>
                  <ArrowIcon />
                </a>
              ))}
            </nav>
          </div>

          <div className="stq-panel stq-connect-panel">
            <div className="stq-section-head">
              <span>Kết nối</span>
              <h3>Theo dõi SmartTech</h3>
            </div>

            <p className="stq-note">
              Cập nhật sản phẩm, giải pháp giám sát và nội dung hỗ trợ vận hành.
            </p>

            <div className="stq-socials" aria-label="Liên kết mạng xã hội">
              <a
                href="https://www.facebook.com/Smarttechnologyandtradingco.Ltd"
                target="_blank"
                rel="noreferrer"
                aria-label="Facebook"
              >
                <FacebookIcon />
                <span>Facebook</span>
              </a>
              <a
                href="https://www.youtube.com/@CONGNGHETHONGMINH_SMARTTECH"
                target="_blank"
                rel="noreferrer"
                aria-label="YouTube"
              >
                <YoutubeIcon />
                <span>YouTube</span>
              </a>
            </div>

            <div className="stq-partners">
              <small>Đối tác chiến lược</small>
              <div className="stq-partner-list">
                {PARTNERS.map((partner) => (
                  <a
                    key={partner.name}
                    href={partner.url}
                    target="_blank"
                    rel="noreferrer"
                    className="stq-partner"
                    title={partner.name}
                  >
                    <img src={partner.logo} alt={partner.name} />
                    <b>{partner.name}</b>
                  </a>
                ))}
              </div>
            </div>
          </div>
        </section>

        <div className="stq-bottom">
          <p>
            © {year} <b>SMARTTECH</b>. All rights reserved.
          </p>
          <p>SmarttechCloud - Version 1.14.7.2</p>
          <p>Device monitoring • Data report • Realtime alert</p>
          
        </div>
      </div>

      <button
        type="button"
        className={`stq-backtop ${showTop ? "is-visible" : ""}`}
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        aria-label="Lên đầu trang"
        title="Lên đầu trang"
      >
        ↑
      </button>
    </footer>
  );
};

export default FooterLayout;
