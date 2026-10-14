import { useEffect, useState, useCallback } from 'react';
import api from '../api/axios'; // <-- Dùng instance api

export interface User {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  address: string;
  roleId: string;
  roleName?: string;
  isActive: boolean;
  passwords?: string;
}

export interface Role {
  id: string;
  roleName: string;
}

export interface ConfirmBoxState {
  open: boolean;
  userId: string | null;
}

export function useAdminAccount() {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [form, setForm] = useState<Partial<User>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [confirmBox, setConfirmBox] = useState<ConfirmBoxState>({ open: false, userId: null });
  const [loading, setLoading] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/admin/accounts');
      setUsers(res.data);
    } catch (err) {
      console.error('Lỗi khi tải tài khoản:', err);
    }
    setLoading(false);
  }, []);

  const fetchRoles = useCallback(async () => {
    try {
      const res = await api.get('/api/admin/roles');
      setRoles(res.data);
    } catch (err) {
      console.error('Lỗi khi tải vai trò:', err);
    }
  }, []);

  useEffect(() => {
    const role = localStorage.getItem('role');
    if (role !== 'admin') {
      alert("Bạn không có quyền truy cập trang này.");
      window.location.href = '/unauthorized';
    } else {
      fetchUsers();
      fetchRoles();
    }
  }, [fetchUsers, fetchRoles]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleAddOrUpdate = async () => {
    setLoading(true);
    try {
      const payload = {
        username: form.email?.split('@')[0] || '',
        passwords: form.passwords || '',
        fullName: form.fullName || '',
        email: form.email || '',
        phone: form.phone || '',
        address: form.address || '',
        roleId: form.roleId || ''
      };

      if (editingId) {
        await api.put(`/api/admin/accounts/${editingId}`, payload);
      } else {
        await api.post('/api/admin/accounts', payload);
      }

      setForm({});
      setEditingId(null);
      fetchUsers();
    } catch (err) {
      console.error('Lỗi khi thêm/cập nhật tài khoản:', err);
    }
    setLoading(false);
  };

  const handleEdit = (user: User) => {
    setForm(user);
    setEditingId(user.id);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Xác nhận xóa tài khoản?')) return;
    setLoading(true);
    try {
      await api.delete(`/api/admin/accounts/${id}`);
      fetchUsers();
    } catch (err) {
      console.error('Lỗi khi xóa tài khoản:', err);
    }
    setLoading(false);
  };

  const handleToggleActive = (id: string) => {
    setConfirmBox({ open: true, userId: id });
  };

  const confirmToggleActive = async () => {
    if (!confirmBox.userId) return;
    setLoading(true);
    try {
      await api.patch(`/api/admin/accounts/${confirmBox.userId}/toggle-active`, {});
      fetchUsers();
    } catch (err) {
      console.error('Lỗi khi cập nhật trạng thái tài khoản:', err);
    }
    setConfirmBox({ open: false, userId: null });
    setLoading(false);
  };

  return {
    users, roles, form, editingId, searchTerm, confirmBox, loading,
    setForm, setEditingId, setSearchTerm, setConfirmBox,
    handleInputChange, handleAddOrUpdate, handleEdit,
    handleToggleActive, handleDelete, confirmToggleActive,
  };
}