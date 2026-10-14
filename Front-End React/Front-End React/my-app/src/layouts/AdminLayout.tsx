import React from 'react';
import { Outlet, Link } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';

const AdminLayout: React.FC = () => {
  const { darkMode, toggleTheme } = useTheme();

  return (
    <div className={`min-h-screen ${darkMode ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-900'}`}>
      <header className="bg-blue-600 text-white p-4 shadow flex justify-between items-center relative">
        <nav className="container mx-auto flex justify-between items-center w-full">
          <h1 className="text-xl font-bold">Quản trị</h1>
          <ul className="flex space-x-4 items-center">
            <li><Link to="/admin" className="hover:underline">Thông tin tài khoản</Link></li>
            <li><Link to="/chart" className="hover:underline">Xem biểu đồ</Link></li>
            <li><Link to="/send-notification" className="hover:underline">Điều phối</Link></li>
          </ul>
        </nav>

        {/* 🌙 Nút theme cố định ngoài cùng bên phải */}
        <button
          onClick={toggleTheme}
          className="theme-toggle-btn bg-yellow-400 text-black rounded-full shadow hover:bg-yellow-300 transition"
          title="Chuyển giao diện"
        >
          {darkMode ? '🌙' : '🌞'}
        </button>
      </header>

      <main className="container mx-auto p-6">
        <Outlet />
      </main>
    </div>
  );
};

export default AdminLayout;
