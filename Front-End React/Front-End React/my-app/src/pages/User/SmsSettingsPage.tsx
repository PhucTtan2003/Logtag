import React, { useEffect, useState } from "react";
import api from "../../api/axios";

const SmsSettingsPage: React.FC = () => {
  const [phones, setPhones] = useState<string[]>(["", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  // Lấy số điện thoại đã lưu
  useEffect(() => {
    (async () => {
      try {
        setInitialLoading(true);
        const res = await api.get("/api/sms/my-phones");
        setPhones([
          res.data?.phone1 || "",
          res.data?.phone2 || "",
          res.data?.phone3 || "",
          res.data?.phone4 || "",
          res.data?.phone5 || "",
        ]);
      } catch (err) {
        console.warn("Không thể load số phone.", err);
        setError("Không thể tải số điện thoại. Vui lòng thử lại sau.");
      } finally {
        setInitialLoading(false);
      }
    })();
  }, []);

  const updatePhone = (index: number, value: string) => {
    setPhones((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const save = async () => {
    setLoading(true);
    setMsg("");
    setError("");

    const trimmed = phones.map((p) => p.trim());
    const nonEmpty = trimmed.filter((p) => p !== "");

    // cần ít nhất 1 số
    if (nonEmpty.length === 0) {
      setError("Cần ít nhất 1 số điện thoại.");
      setLoading(false);
      return;
    }

    // check trùng
    const distinct = Array.from(new Set(nonEmpty));
    if (distinct.length !== nonEmpty.length) {
      setError("Các số điện thoại bị trùng nhau, vui lòng kiểm tra lại.");
      setLoading(false);
      return;
    }

    try {
      await api.post("/api/sms/set-phones", {
        phone1: trimmed[0],
        phone2: trimmed[1],
        phone3: trimmed[2],
        phone4: trimmed[3],
        phone5: trimmed[4],
      });

      setMsg("Đã lưu số điện thoại!");
    } catch (err: any) {
      const apiMsg = err?.response?.data?.message;
      setError(apiMsg || "Lỗi lưu số điện thoại. Vui lòng thử lại.");
    } finally {
      setLoading(false);
    }
  };

  // ====== styles nhỏ gọn để reuse ======
  const labelStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    fontWeight: 600,
    marginBottom: 4,
    fontSize: 13,
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #d4d4d8",
    borderRadius: 10,
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
  };

  const hintStyle: React.CSSProperties = {
    marginTop: 4,
    fontSize: 12,
    color: "#6b7280",
  };

  return (
    <div
      style={{
        padding: 18,
        maxWidth: 520,
        margin: "0 auto",
        borderRadius: 16,
        background: "linear-gradient(180deg,#ffffff,#f9fafb)",
        boxShadow: "0 18px 40px rgba(15,23,42,0.18)",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 999,
            background: "linear-gradient(135deg,#2563eb,#22d3ee)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: 22,
          }}
        >
          📩
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Thiết lập SMS cảnh báo</h2>
          <p style={{ margin: "2px 0 0", fontSize: 13, color: "#6b7280" }}>
            Nhập tối đa <b>5 số điện thoại</b> để nhận tin nhắn cảnh báo khi có sự cố.
          </p>
        </div>
      </div>

      <hr style={{ border: "none", borderTop: "1px solid #e5e7eb", margin: "10px 0 14px" }} />

      {initialLoading ? (
        <p style={{ marginTop: 16 }}>Đang tải số điện thoại...</p>
      ) : (
        <>
          {[0, 1, 2, 3, 4].map((i) => (
            <div style={{ marginTop: i === 0 ? 0 : 12 }} key={i}>
              <div style={labelStyle}>
                <span>
                  Số {i + 1}
                  {i === 0 ? " (bắt buộc)" : " (tùy chọn)"}
                </span>
                {i === 0 && (
                  <span
                    style={{
                      fontSize: 11,
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: "#eef2ff",
                      color: "#4f46e5",
                      fontWeight: 700,
                    }}
                  >
                    Số chính
                  </span>
                )}
              </div>
              <input
                value={phones[i]}
                onChange={(e) => updatePhone(i, e.target.value)}
                placeholder="Ví dụ: 0987654321"
                style={inputStyle}
              />
              {i === 0 && (
                <div style={hintStyle}>
                  Số đầu tiên sẽ được ưu tiên dùng khi cần cập nhật thông tin SMS.
                </div>
              )}
            </div>
          ))}

          <button
            onClick={save}
            disabled={loading}
            style={{
              marginTop: 18,
              padding: "11px 18px",
              width: "100%",
              background: "linear-gradient(135deg,#2563eb,#22c55e)",
              color: "white",
              border: "none",
              borderRadius: 999,
              fontWeight: 700,
              fontSize: 14,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.7 : 1,
              boxShadow: "0 12px 30px rgba(37,99,235,0.35)",
            }}
          >
            {loading ? "Đang lưu..." : "Lưu số điện thoại"}
          </button>

          <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280", lineHeight: 1.4 }}>
            • Hệ thống sẽ kiểm tra định dạng số điện thoại Việt Nam.<br />
            • Không cho phép trùng lặp giữa các số trong danh sách.
          </div>
        </>
      )}

      {msg && (
        <div
          style={{
            marginTop: 14,
            padding: 10,
            borderRadius: 10,
            background: "#ecfdf5",
            border: "1px solid #bbf7d0",
            color: "#166534",
            fontSize: 13,
          }}
        >
          {msg}
        </div>
      )}

      {error && (
        <div
          style={{
            marginTop: 10,
            padding: 10,
            borderRadius: 10,
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#b91c1c",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
};

export default SmsSettingsPage;
