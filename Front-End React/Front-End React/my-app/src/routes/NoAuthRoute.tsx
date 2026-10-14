import { Navigate } from 'react-router-dom';

export default function NoAuthRoute({ children }: { children: React.ReactNode }) {
  const role = localStorage.getItem('role');
  if (role === 'admin') return <Navigate to="/admin" replace />;
  if (role === 'user') return <Navigate to="/user" replace />;
  if (role === 'employee') return <Navigate to="/employee" replace />;
  // Nếu chưa đăng nhập, render children (trang Login)
  return <>{children}</>;
}
