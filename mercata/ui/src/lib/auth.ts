import { api } from './axios';

// Check authentication status via server API call (works with HttpOnly cookies)
export const isAuthenticated = async (): Promise<boolean> => {
  try {
    // Make a request to check auth status - the cookie will be sent automatically
    await api.get('/user/me');
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

// Logout function that redirects to external logout endpoint
export const logout = (): void => {
  window.location.href = '/auth/logout';
}; 
