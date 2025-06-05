import React, { useEffect } from 'react';
import { useUser } from '@/context/UserContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { isLoggedIn, loading } = useUser();

  useEffect(() => {
    // Only redirect if not loading and not authenticated
    if (!loading && !isLoggedIn) {
      // Redirect to login page if not authenticated
      window.location.href = '/login';
    }
  }, [isLoggedIn, loading]);

  // Show loading state while checking authentication
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  // Don't render anything if not authenticated (will redirect)
  if (!isLoggedIn) {
    return null;
  }

  return <>{children}</>;
};

export default ProtectedRoute; 