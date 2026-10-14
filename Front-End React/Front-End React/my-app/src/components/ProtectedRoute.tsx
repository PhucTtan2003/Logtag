// src/components/ProtectedRoute.tsx
import React from 'react';
import { Navigate } from 'react-router-dom';

interface ProtectedRouteProps {
  roleRequired: string;
  userRole: string | null;
  children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ roleRequired, userRole, children }) => {
  if (!userRole) {
    return <Navigate to="/login" replace />;
  }

  if (userRole.toLowerCase() !== roleRequired.toLowerCase()) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
