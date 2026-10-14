import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

type Props = {
  role: string | string[]; // cho phép truyền 1 role hoặc mảng role
  children: React.ReactNode;
};

const RequireRole: React.FC<Props> = ({ role, children }) => {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Chuyển role về mảng để dễ check
  const allowedRoles = Array.isArray(role) ? role : [role];

  // Nếu không đúng role, chuyển về trang /unauthorized hoặc trang theo ý anh
  if (!allowedRoles.includes(user.role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <>{children}</>;
};

export default RequireRole;