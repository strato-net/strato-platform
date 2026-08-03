// CSRF token support for Swagger UI (Express backend)
(function() {
  // Helper function to get cookie value by name
  function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
  }

  // Initialize CSRF token by making a GET request
  async function initializeCsrfToken() {
    try {
      const response = await fetch('/csrf-init', {
        method: 'GET',
        credentials: 'include'
      });
      if (response.ok) {
        console.log('[Swagger CSRF] Token initialized successfully');
      } else {
        console.warn('[Swagger CSRF] Token initialization returned status:', response.status);
      }
    } catch (e) {
      console.warn('[Swagger CSRF] Failed to initialize token:', e.message);
    }
  }

  // Initialize token on page load
  initializeCsrfToken();

  // Intercept Swagger UI requests to add CSRF token
  const originalFetch = window.fetch;
  window.fetch = function(url, options) {
    options = options || {};
    
    // Only add CSRF token for state-changing methods
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
      const csrfToken = getCookie('CSRF-TOKEN');
      
      if (csrfToken) {
        options.headers = options.headers || {};
        options.headers['X-Csrf-Token'] = csrfToken;
        console.log('[Swagger CSRF] Added X-Csrf-Token header to', method, url);
      } else {
        console.warn('[Swagger CSRF] No CSRF-TOKEN cookie found for', method, url);
      }
    }
    
    return originalFetch.apply(this, arguments);
  };
})();

