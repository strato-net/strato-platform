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
