// Custom Swagger UI initialization with CSRF token support
window.onload = function() {
  // Helper function to get cookie value by name
  function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
  }

  // Initialize CSRF token by making a GET request
  // This ensures the token is generated before any POST/PUT/PATCH/DELETE requests
  // Always calls /csrf-init to ensure fresh token, even if cookie exists
  async function initializeCsrfToken() {
    try {
      // Make a GET request to the dedicated CSRF initialization endpoint
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

  // Initialize token first, then load Swagger UI
  initializeCsrfToken().then(() => {
    // Initialize Swagger UI with CSRF token interceptor
    window.ui = SwaggerUIBundle({
      url: "/docs/swagger.yaml",
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [
        SwaggerUIBundle.presets.apis,
        SwaggerUIStandalonePreset
      ],
      plugins: [
        SwaggerUIBundle.plugins.DownloadUrl
      ],
      layout: "StandaloneLayout",
      // Request interceptor to add CSRF token for state-changing requests
      requestInterceptor: function(request) {
        // Safety check: ensure method exists
        if (!request || !request.method) {
          return request;
        }
        
        const method = request.method.toUpperCase();
        
        // Only add CSRF token for state-changing methods
        if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
          const csrfToken = getCookie('CSRF-TOKEN');
          
          if (csrfToken) {
            // Add the CSRF token header
            request.headers['X-Csrf-Token'] = csrfToken;
            console.log('[Swagger CSRF] Added X-Csrf-Token header to', method, request.url);
          } else {
            console.warn('[Swagger CSRF] No CSRF-TOKEN cookie found for', method, request.url);
          }
        }
        
        return request;
      },
      // Response interceptor for debugging
      responseInterceptor: function(response) {
        if (response.status === 403) {
          console.error('[Swagger CSRF] Request rejected (403). CSRF token may be invalid or missing.');
        }
        return response;
      }
    });
  });
};

