import { useUser } from '@/context/UserContext';
import { useTheme } from 'next-themes';

export const useAuthAction = () => {
  const { isLoggedIn } = useUser();
  const { resolvedTheme } = useTheme();
  
  const redirectToLogin = () => {
    window.location.href = `/login?theme=${resolvedTheme || 'light'}`;
  };
  
  return {
    isLoggedIn,
    canPerformAction: isLoggedIn,
    redirectToLogin,
  };
};

