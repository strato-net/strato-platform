// src/lib/csrf.ts

/**
 * Get CSRF token from cookie
 * The token is set by nginx on the first GET request
 * @returns CSRF token or null if not found
 */
export function getCsrfToken(): string | null {
  const match = document.cookie.match(/CSRF-TOKEN=([^;]+)/);
  return match ? match[1] : null;
}

/**
 * Initialize CSRF token by making a GET request
 * Call this on app startup to ensure token is available
 */
export async function initializeCsrfToken(): Promise<void> {
  try {
    // Make any GET request to trigger CSRF token generation
    // Using a lightweight endpoint
    await fetch('/csrf-init', { credentials: 'include' });
  } catch (error) {
    console.warn('Failed to initialize CSRF token:', error);
  }
}

