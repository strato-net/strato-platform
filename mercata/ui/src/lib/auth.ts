import { api } from './axios';
import { clearDismissedForUser, LAST_USER_ADDRESS_KEY } from '@/hooks/useLiquidationDismiss';

// Check authentication status via server API call (works with HttpOnly cookies)
export const isAuthenticated = async (): Promise<boolean> => {
  try {
    // Make a request to check auth status - the cookie will be sent automatically
    await api.get('/user/me');
    return true;
  } catch (error) {
    // If we get a 401, the user is not authenticated
    if (error.response?.status === 401) {
      return false;
    }
    // For other errors, assume authentication issue
    return false;
  }
};

// Logout function that redirects to external logout endpoint
export const logout = (): void => {
  try {
    const lastUserAddress = localStorage.getItem(LAST_USER_ADDRESS_KEY);
    if (lastUserAddress) {
      clearDismissedForUser(lastUserAddress);
      localStorage.removeItem(LAST_USER_ADDRESS_KEY);
    }
  } catch {
    // Ignore storage errors
  }
  window.location.href = '/auth/logout';
};

// Redirect to login, preserving the current page path so that nginx can
// redirect back after successful OIDC authentication.
export const redirectToLogin = (returnTo?: string): void => {
  const theme = localStorage.getItem('theme') || 'light';
  const params = new URLSearchParams({ theme });

  const path = returnTo ?? (window.location.pathname + window.location.search);
  if (path && path !== '/' && path !== '/dashboard') {
    params.set('returnTo', path);
  }

  window.location.href = `/login?${params.toString()}`;
};
