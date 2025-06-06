import { api } from './axios';

// Check authentication status via server API call (works with HttpOnly cookies)
export const isAuthenticated = async (): Promise<boolean> => {
  try {
    // Make a request to check auth status - the cookie will be sent automatically
    await api.get('/users/me');
    return true;
  } catch (error: any) {
    // If we get a 401, the user is not authenticated
    if (error.response?.status === 401) {
      return false;
    }
    // For other errors, assume authentication issue
    return false;
  }
};

// Synchronous version for immediate checks (fallback)
export const isAuthenticatedSync = (): boolean => {
  // Check if mercata_session cookie exists in document.cookie (fallback for non-HttpOnly)
  return document.cookie
    .split(';')
    .some(cookie => cookie.trim().startsWith('mercata_session='));
};

export const checkAuthAndRedirect = async (): Promise<boolean> => {
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    // Redirect to login page if not authenticated
    window.location.href = '/login';
    return false;
  }
  return true;
};

// Logout function that redirects to external logout endpoint
export const logout = (): void => {
  window.location.href = '/auth/logout';
}; 