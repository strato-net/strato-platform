import React, { useEffect } from 'react';
import { useUser } from '@/context/UserContext';
import { redirectToLogin } from '@/lib/auth';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { isLoggedIn, loading } = useUser();

  useEffect(() => {
    // Only redirect if not loading and not authenticated
    if (!loading && !isLoggedIn) {
      // Redirect to login page if not authenticated
      redirectToLogin();
    }
  }, [isLoggedIn, loading]);

  // Don't render anything if not authenticated (will redirect)
  if (!loading && !isLoggedIn) {
    return null;
  }

  // Render children even while loading - let them handle their own loading states
  return <>{children}</>;
};

export default ProtectedRoute; 