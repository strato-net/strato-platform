import React, { useEffect } from 'react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useUser } from '@/context/UserContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { isLoggedIn, loading } = useUser();
  const { openConnectModal } = useConnectModal();
  const hasOpenedConnectModal = React.useRef(false);

  useEffect(() => {
    if (isLoggedIn) {
      hasOpenedConnectModal.current = false;
      return;
    }

    if (!loading && !hasOpenedConnectModal.current && openConnectModal) {
      hasOpenedConnectModal.current = true;
      openConnectModal();
    }
  }, [isLoggedIn, loading, openConnectModal]);

  // Don't render protected content until a wallet or app session is connected.
  if (!loading && !isLoggedIn) {
    return null;
  }

  // Render children even while loading - let them handle their own loading states
  return <>{children}</>;
};

export default ProtectedRoute; 