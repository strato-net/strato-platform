import { api } from './axios';
import { clearDismissedForUser, LAST_USER_ADDRESS_KEY } from '@/hooks/useLiquidationDismiss';

export const WALLET_CONNECT_REQUEST_EVENT = 'mercata:wallet-connect-request';

// Check authentication status via server API call (works with HttpOnly cookies).
// Uses fetch directly to bypass the Axios 401 interceptor — this is a probe,
// not a user action, so a 401 here means "not logged in," not "session expired."
export const isAuthenticated = async (): Promise<boolean> => {
  try {
    const res = await fetch('/api/user/me', { credentials: 'include' });
    return res.ok;
  } catch {
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

export const requestWalletConnection = (): void => {
  window.dispatchEvent(new CustomEvent(WALLET_CONNECT_REQUEST_EVENT));
};
