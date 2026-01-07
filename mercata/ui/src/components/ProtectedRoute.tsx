import React from 'react';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  // Allow view-only access for non-logged users
  return <>{children}</>;
};

export default ProtectedRoute; 