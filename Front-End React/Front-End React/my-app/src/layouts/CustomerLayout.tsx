import React from 'react';
import { Outlet, Link } from 'react-router-dom';

const CustomerLayout: React.FC = () => {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Header / Navbar */}
      <header className="bg-green-600 text-white p-4 shadow">
        <nav className="container mx-auto flex justify-between items-center">
          <h1 className="text-xl font-bold">Customer Portal</h1>
          <ul className="flex space-x-4">
            <li><Link to="/" className="hover:underline">Trang chủ</Link></li>
            <li><Link to="/customer" className="hover:underline">Tài khoản</Link></li>
            <li><Link to="/login" className="hover:underline">Đăng xuất</Link></li>
          </ul>
        </nav>
      </header>

      {/* Nội dung chính */}
      <main className="container mx-auto p-6">
        <Outlet />
      </main>
    </div>
  );
};

export default CustomerLayout;
