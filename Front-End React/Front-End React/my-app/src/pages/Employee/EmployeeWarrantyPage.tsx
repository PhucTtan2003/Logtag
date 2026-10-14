import React, { useEffect, useState } from 'react';
import axios from 'axios';
import '../../styles/Employee/EmployeeWarrantyPage.css';

interface Warranty {
  deviceId: string;
  title: string;
  content: string;
  createdAt: string;
}

export default function EmployeeWarrantyPage() {
  const [warranties, setWarranties] = useState<Warranty[]>([]);
  const [loading, setLoading] = useState(true);
  const baseUrl = process.env.REACT_APP_API_BASE_URL || '';

  useEffect(() => {
    const employeeId = localStorage.getItem('accountId');
    if (!employeeId) {
      alert('Không tìm thấy tài khoản nhân viên!');
      setLoading(false);
      return;
    }

    axios
      .get(`${baseUrl}/api/warranty/get-by-employee/${employeeId}`)
      .then((res) => setWarranties(res.data))
      .catch((err) => {
        console.error('Lỗi khi lấy danh sách bảo hành:', err);
        alert('Không thể tải danh sách bảo hành!');
      })
      .finally(() => setLoading(false));
  }, [baseUrl]);

  return (
    <div className="warranty-container">
      <h2 className="warranty-title">🛠️ Yêu cầu bảo hành của bạn</h2>

      {loading ? (
        <p className="loading-text">⏳ Đang tải dữ liệu...</p>
      ) : warranties.length === 0 ? (
        <p className="no-data-text">Không có yêu cầu bảo hành nào được giao cho bạn.</p>
      ) : (
        <div className="card-grid">
          {warranties.map((w, index) => (
            <div className="card" key={index}>
              <div className="card-header">📦 Thiết bị: {w.deviceId}</div>
              <div className="card-body">
                <p><strong>📌 Tiêu đề:</strong> {w.title}</p>
                <p><strong>📝 Nội dung:</strong> {w.content}</p>
                <p><strong>⏰ Thời gian:</strong> {w.createdAt}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
