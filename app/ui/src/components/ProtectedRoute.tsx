import React, { useEffect } from 'react';
import { useAccount } from 'wagmi';
import { useUser } from '@/context/UserContext';
import { redirectToLogin } from '@/lib/auth';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { isLoggedIn, loading: authLoading } = useUser();
  // On a reload a wallet session exists only once the wallet has reconnected, which
  // can take longer than the vault session check
  const { isReconnecting } = useAccount();
  const loading = authLoading || isReconnecting;

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