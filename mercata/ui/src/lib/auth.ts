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

/** OIDC session at `/login`. Required for STRATO vault signer (`/vault/signature`), which is unrelated to RainbowKit wallets. */
export const redirectToOAuthLogin = (returnTo?: string): void => {
  const theme = localStorage.getItem('theme') || 'light';
  const params = new URLSearchParams({ theme });

  const path = returnTo ?? (window.location.pathname + window.location.search);
  if (path && path !== '/' && path !== '/dashboard') {
    params.set('returnTo', path);
  }

  window.location.href = `/login?${params.toString()}`;
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

export const requestWalletConnection = (returnTo?: string): void => {
  window.dispatchEvent(new CustomEvent(WALLET_CONNECT_REQUEST_EVENT, {
    detail: { returnTo },
  }));
};

// Preserve the old call site name, but auth prompts now use wallet connect.
export const redirectToLogin = requestWalletConnection;
