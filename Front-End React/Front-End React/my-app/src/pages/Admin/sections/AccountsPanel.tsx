import React from "react";
import { useAdminAccount } from "../../../hooks/useAdminAccount";
import { UserRound, Lock, Unlock, Trash2, Edit2, Loader2 } from "lucide-react";

const AccountsPanel: React.FC = () => {
  const {
    users,
    roles,
    form,
    editingId,
    searchTerm,
    confirmBox,
    loading,
    setForm,
    setEditingId,
    setSearchTerm,
    setConfirmBox,
    handleInputChange,
    handleAddOrUpdate,
    handleEdit,
    handleToggleActive,
    handleDelete,
    confirmToggleActive,
  } = useAdminAccount();

  return (
    <>
      <h2 className="admin-title">🔧 Quản lý tài khoản</h2>

      <div className="admin-form">
        <input name="fullName" placeholder="Họ tên" value={form.fullName || ""} onChange={handleInputChange} />
        <input name="email" placeholder="Email" value={form.email || ""} onChange={handleInputChange} />
        <input name="phone" placeholder="SĐT" value={form.phone || ""} onChange={handleInputChange} />
        <input name="address" placeholder="Địa chỉ" value={form.address || ""} onChange={handleInputChange} />
        <input name="passwords" placeholder="Mật khẩu" type="password" autoComplete="new-password" value={form.passwords || ""} onChange={handleInputChange} />
        <select title="chọn vai trò" name="roleId" value={form.roleId || ""} onChange={handleInputChange}>
          <option value="">-- Chọn vai trò --</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>{r.roleName}</option>
          ))}
        </select>
        <button onClick={handleAddOrUpdate} disabled={loading}>
          {loading ? <Loader2 className="spin" size={18} /> : (editingId ? <Edit2 size={16} /> : <UserRound size={16} />)}
          {editingId ? "Cập nhật" : "Thêm"}
        </button>
        {editingId && (
          <button onClick={() => { setForm({}); setEditingId(null); }}>Hủy</button>
        )}
      </div>

      <div className="search-box">
        <input
          type="text"
          placeholder="Tìm theo họ tên..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>
      <br />

      <div className="table-container">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Họ tên</th>
              <th>Email</th>
              <th>SĐT</th>
              <th>Địa chỉ</th>
              <th>Mật khẩu</th>
              <th>Vai trò</th>
              <th>Trạng thái</th>
              <th>Hành động</th>
            </tr>
          </thead>
          <tbody>
            {users
              .filter((u) => u.fullName.toLowerCase().includes(searchTerm.toLowerCase()))
              .map((u) => (
                <tr key={u.id}>
                  <td>{u.fullName}</td>
                  <td>{u.email}</td>
                  <td>{u.phone}</td>
                  <td>{u.address}</td>
                  <td>••••••••</td>
                  <td>{u.roleName || "N/A"}</td>
                  <td className={u.isActive ? "status-active" : "status-inactive"}>
                    {u.isActive ? "✔️ Hoạt động" : "❌ Bị khóa"}
                  </td>
                  <td>
                    <button className="table-action-btn edit" onClick={() => handleEdit(u)} title="Sửa">
                      <Edit2 size={15} />
                    </button>
                    {u.roleName?.toLowerCase() !== "admin" && (
                      <button className="table-action-btn delete" onClick={() => handleDelete(u.id)} title="Xóa">
                        <Trash2 size={15} />
                      </button>
                    )}
                    <button className="table-action-btn lock" onClick={() => handleToggleActive(u.id)} title={u.isActive ? "Khóa" : "Mở khóa"}>
                      {u.isActive ? <Lock size={15} /> : <Unlock size={15} />}
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>

        {loading && (
          <div className="wow-table-loading">
            <Loader2 className="spin" size={28} />
          </div>
        )}
      </div>

      {confirmBox.open && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <h3>
              Bạn có muốn{" "}
              {users.find((u) => u.id === confirmBox.userId)?.isActive ? "khóa" : "mở khóa"} tài khoản này không?
            </h3>
            <div className="confirm-actions">
              <button onClick={confirmToggleActive} disabled={loading}>Xác nhận</button>
              <button onClick={() => setConfirmBox({ open: false, userId: null })} disabled={loading}>Hủy</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
export default AccountsPanel;