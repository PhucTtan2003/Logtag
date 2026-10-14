import React, { useState, useEffect } from 'react';
import api from '../../api/axios';
import '../../styles/Warranty/WarrantyModal.css';
import Toast from '../../components/Toast'; // ✅ dùng toast chung

interface Props {
  deviceId: string;          // đang nhận serialNumber
  deviceName?: string;
  onClose: () => void;
}

interface Employee {
  accountId: string;         // ObjectId dạng string (24 ký tự)
  fullName: string;
}

export default function WarrantyModal({ deviceId, deviceName, onClose }: Props) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [submitting, setSubmitting] = useState(false);


  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  useEffect(() => {
    api.get('/api/admin/employees')
      .then(res => setEmployees(res.data ?? []))
      .catch(() => setEmployees([]));
  }, []);

  const handleSubmit = async () => {
    if (submitting) return;

    if (!deviceId?.trim()) {
      setToast({ message: '❌ Serial number thiết bị không hợp lệ!', type: 'error' });
      return;
    }
    if (!selectedEmployee || selectedEmployee.length !== 24) {
      setToast({ message: '❌ Vui lòng chọn nhân viên hợp lệ!', type: 'error' });
      return;
    }
    if (!title.trim()) {
      setToast({ message: '❌ Vui lòng nhập tiêu đề!', type: 'error' });
      return;
    }

    try {
      setSubmitting(true);
      const payload = {
        serialNumber: deviceId.trim(),
        title: title.trim(),
        content: content.trim(),
        assignedEmployeeId: selectedEmployee.trim(),
      };

      const response = await api.post('/api/warranty/create', payload);

      // 👉 hiện toast thành công rồi đóng modal sau 2s
      setToast({ message: response.data?.message ?? '✅ Gửi bảo hành thành công.', type: 'success' });
      setTimeout(() => {
        setToast(null);
        onClose();
      }, 2000);
    } catch (error) {
      setToast({ message: '❌ Gửi bảo hành thất bại!', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <h3>🛠️ Bảo hành thiết bị</h3>
        <p><strong>Thiết bị (serial):</strong> {deviceId}</p>

        <input
          type="text"
          placeholder="Tiêu đề"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={submitting}
        />
        <textarea
          placeholder="Nội dung"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          disabled={submitting}
        />

        <label>👨‍🔧 Nhân viên phụ trách:</label>
        <select
          title="Chọn nhân viên"
          value={selectedEmployee}
          onChange={(e) => setSelectedEmployee(e.target.value)}
          disabled={submitting}
        >
          <option value="">-- Chọn nhân viên --</option>
          {employees.map((e) => (
            <option key={e.accountId} value={e.accountId}>
              {e.fullName}
            </option>
          ))}
        </select>

        <div className="modal-actions">
          <button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Đang gửi...' : 'Gửi'}
          </button>
          <button onClick={onClose} disabled={submitting}>Đóng</button>
        </div>
      </div>

      {/* ✅ dùng Toast chung */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
          durationMs={toast.type === 'success' ? 2000 : 3000}
        />
      )}
    </div>
  );
}