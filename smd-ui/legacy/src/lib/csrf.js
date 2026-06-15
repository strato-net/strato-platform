// src/lib/csrf.js

/**
 * Get CSRF token from cookie
 * The token is set by nginx on the first GET request
 * @returns {string|null} CSRF token or null if not found
 */
export function getCsrfToken() {
  const match = document.cookie.match(/CSRF-TOKEN=([^;]+)/);
  return match ? match[1] : null;
}

/**
 * Secure fetch wrapper that automatically includes CSRF token
 * Use this instead of regular fetch() for API calls
 * 
 * @param {string} url - Request URL
 * @param {RequestInit} options - Fetch options
 * @returns {Promise<Response>}
 */
export function secureFetch(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const needsCsrf = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);

  // Build headers
  const headers = {
    ...options.headers,
  };

  // Add CSRF token for state-changing methods
  if (needsCsrf) {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    } else {
      console.warn('CSRF token not found. Request may fail.');
    }
  }

  // Make request
  return fetch(url, {
    ...options,
    credentials: options.credentials || 'include', // Ensure cookies are sent
    headers,
  });
}

/**
 * Initialize CSRF token by making a GET request
 * Call this on app startup to ensure token is available
 */
export async function initializeCsrfToken() {
  try {
    // Make a GET request to a CSRF-protected endpoint to trigger token generation
    // Using /strato-api/ which has CSRF protection enabled
    await fetch('/csrf-init', { credentials: 'include' });
  } catch (error) {
    console.warn('Failed to initialize CSRF token:', error);
  }
}

