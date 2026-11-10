import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '@/context/UserContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { isLoggedIn, loading } = useUser();
  const navigate = useNavigate();

  useEffect(() => {
    // Only redirect if not loading and not authenticated
    if (!loading && !isLoggedIn) {
      // Send a signed-out visitor, or a wallet not yet reconnected after a reload, to the
      // dashboard, where they can sign in or connect, not into the OIDC login
      navigate('/dashboard', { replace: true });
    }
  }, [isLoggedIn, loading, navigate]);

  // Don't render anything if not authenticated (will redirect)
  if (!loading && !isLoggedIn) {
    return null;
  }

  // Render children even while loading - let them handle their own loading states
  return <>{children}</>;
};

export default ProtectedRoute; 