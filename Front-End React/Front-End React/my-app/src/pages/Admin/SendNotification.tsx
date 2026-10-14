import React, { useEffect, useRef, useState } from 'react';
import api from '../../api/axios';
import '../../styles/Admin/SendNotification.css';
import Select from 'react-select';
import Toast from '../../components/Toast';   // ✅ dùng toast chung

interface User {
  accountId: string;
  fullName: string;
}

interface SendNotificationProps {
  onClose?: () => void;
}

const SendNotification: React.FC<SendNotificationProps> = ({ onClose }) => {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [sentTo, setSentTo] = useState<string[]>([]);
  const [isAll, setIsAll] = useState<boolean>(true);

  const [employees, setEmployees] = useState<User[]>([]);
  const [isClosing, setIsClosing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const titleRef = useRef<HTMLInputElement>(null);
  const adminId = localStorage.getItem('accountId') || '';

  useEffect(() => {
    api.get<User[]>('/api/admin/employees')
      .then(res => setEmployees(res.data ?? []))
      .catch(err => {
        console.error('❌ Lỗi khi lấy danh sách nhân viên:', err);
        setToast({ message: 'Không thể lấy danh sách nhân viên.', type: 'error' });
      });
  }, []);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const handleSend = async () => {
    if (submitting) return;

    if (!title.trim() || !message.trim()) {
      setToast({ message: '❌ Vui lòng nhập tiêu đề và nội dung.', type: 'error' });
      return;
    }
    if (!isAll && sentTo.length === 0) {
      setToast({ message: '❌ Vui lòng chọn người nhận.', type: 'error' });
      return;
    }

    const payload = {
      title: title.trim(),
      message: message.trim(),
      sentBy: adminId,
      sentTo: isAll ? null : sentTo,
    };

    try {
      setSubmitting(true);
      await api.post('/api/admin/notifications/send', payload);

      setToast({ message: '✅ Gửi thông báo thành công!', type: 'success' });
      setTitle('');
      setMessage('');
      setSentTo([]);
      setTimeout(() => onClose?.(), 1500);
    } catch (err: any) {
      console.error('Lỗi gửi:', err?.response?.data || err);
      setToast({ message: err?.response?.data?.message || '❌ Gửi thông báo thất bại!', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => onClose?.(), 300);
  };

  return (
    <>
      <div className={`send-popup-container ${isClosing ? 'fade-out' : ''}`}>
        <div className="send-card send-popup animate-fade-in">
          <div className="send-header">
            <h2><span className="icon">📢</span> Gửi Thông Báo</h2>
            <button onClick={handleClose} className="close-btn">×</button>
          </div>

          <div className="send-group">
            <label>📝 Tiêu đề:</label>
            <input
              ref={titleRef}
              type="text"
              className="send-input"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Nhập tiêu đề thông báo..."
              disabled={submitting}
            />
          </div>

          <div className="send-group">
            <label>💬 Nội dung:</label>
            <textarea
              className="send-textarea"
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Nhập nội dung thông báo..."
              disabled={submitting}
            />
          </div>

          <div className="send-group">
            <label>👥 Gửi tới:</label>
            {!isAll && (
              <Select
                isMulti
                options={employees.map(emp => ({ value: emp.accountId, label: emp.fullName }))}
                onChange={(selected: any) => setSentTo((selected || []).map((s: any) => s.value))}
                className="mb-4"
                isDisabled={submitting}
              />
            )}
            <div className="flex items-center gap-2 mb-3">
              <input
                title="Gửi tới tất cả nhân viên"
                type="checkbox"
                checked={isAll}
                onChange={(e) => setIsAll(e.target.checked)}
                disabled={submitting}
              />
              <span>Gửi cho tất cả nhân viên</span>
            </div>
          </div>

          <div className="send-actions">
            <button className="send-btn cancel" onClick={handleClose} disabled={submitting}>❌ Hủy</button>
            <button className="send-btn primary" onClick={handleSend} disabled={submitting}>
              {submitting ? 'Đang gửi…' : '🚀 Gửi Thông Báo'}
            </button>
          </div>
        </div>
      </div>

      {/* ✅ Toast chung */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
          durationMs={toast.type === 'success' ? 2000 : 3000}
        />
      )}
    </>
  );
};

export default SendNotification;
