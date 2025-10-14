# CSRF Protection - Frontend Integration Guide

## Overview

CSRF (Cross-Site Request Forgery) protection is implemented at the nginx edge using the **Double-Submit Cookie Pattern**. This protects browser-based API requests from CSRF attacks with **zero backend changes required**.

**Important**: CSRF protection is **only enforced for browser requests** (detected via User-Agent). API clients like curl, Postman, mobile apps, and server-to-server calls are **automatically exempt** for better developer experience.

## How It Works

1. **User-Agent Detection**: Nginx checks if the request is from a browser (vs API client like curl/Postman)
2. **For browser requests only**:
   - On GET requests: Nginx generates a random CSRF token and sends it to the browser as a cookie named `CSRF-TOKEN`
   - On POST/PUT/DELETE/PATCH requests: Nginx validates that the `X-CSRF-Token` header matches the `CSRF-TOKEN` cookie
   - Token is also stored server-side (in nginx shared memory) to prevent cookie injection attacks
3. **For API clients** (curl, Postman, mobile apps, etc.): CSRF protection is automatically skipped

## Protected Endpoints

The following endpoints require CSRF tokens for state-changing operations (POST, PUT, DELETE, PATCH):

- `/api/*` - Mercata backend API
- `/apex-api/user` - User management
- `/apex-api/status` - Status updates
- `/bloc/v2.2/*` - Blockchain transactions
- `/strato-api/*` - Blockchain API
- `/strato/v2.3/transaction` - Transaction submission
- `/strato/v2.3/key` - Key management
- `/strato/v2.3/users` - User management

## Frontend Implementation

### Step 1: Obtain CSRF Token

Use the dedicated `/csrf-init` endpoint to generate a CSRF token. The server will automatically set the `CSRF-TOKEN` cookie:

```javascript
// Make a GET request to the CSRF initialization endpoint
// The token will be automatically set as a cookie
await fetch('/csrf-init', {
  credentials: 'include'
});
```

**Note**: Alternatively, making any GET request to any protected endpoint will also generate a token, but `/csrf-init` is the recommended endpoint specifically designed for this purpose.

### Step 2: Read the Token from Cookie

Create a helper function to read the CSRF token from cookies:

```javascript
function getCsrfToken() {
  const match = document.cookie.match(/CSRF-TOKEN=([^;]+)/);
  return match ? match[1] : null;
}
```

### Step 3: Include Token in State-Changing Requests

For all POST, PUT, DELETE, and PATCH requests, include the token in the `X-CSRF-Token` header:

```javascript
// Example: POST request with CSRF token
const csrfToken = getCsrfToken();

await fetch('/api/transactions', {
  method: 'POST',
  credentials: 'include',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrfToken
  },
  body: JSON.stringify({ ... })
});
```

### Step 4 (Optional): Create a Fetch Wrapper

For convenience, create a wrapper that automatically includes the CSRF token:

```javascript
async function secureFetch(url, options = {}) {
  const csrfToken = getCsrfToken();
  
  // Only add CSRF token for state-changing methods
  const method = (options.method || 'GET').toUpperCase();
  const needsCsrf = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);
  
  const headers = {
    ...options.headers,
    ...(needsCsrf && csrfToken ? { 'X-CSRF-Token': csrfToken } : {})
  };
  
  return fetch(url, {
    ...options,
    credentials: 'include',
    headers
  });
}

// Usage
await secureFetch('/api/transactions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ... })
});
```

## Error Handling

If CSRF validation fails, the server will return:

```json
HTTP/1.1 403 Forbidden
Content-Type: application/json

{
  "error": "CSRF protection: invalid or missing token"
}
```

Or if no session exists:

```json
HTTP/1.1 403 Forbidden
Content-Type: application/json

{
  "error": "CSRF protection: session required"
}
```

Handle these errors in your frontend:

```javascript
try {
  const response = await secureFetch('/api/transaction', {
    method: 'POST',
    body: JSON.stringify(data)
  });
  
  if (response.status === 403) {
    const error = await response.json();
    if (error.error.includes('CSRF protection')) {
      // CSRF validation failed - possibly token expired
      // Option 1: Refresh the page to get a new token
      // Option 2: Make a GET request to refresh the token, then retry
      console.error('CSRF validation failed:', error.error);
    }
  }
} catch (error) {
  console.error('Request failed:', error);
}
```

## React/Axios Example

If using Axios, you can set up an interceptor:

```javascript
import axios from 'axios';

// Helper to get CSRF token
function getCsrfToken() {
  const match = document.cookie.match(/CSRF-TOKEN=([^;]+)/);
  return match ? match[1] : null;
}

// Add CSRF token to all state-changing requests
axios.interceptors.request.use(config => {
  const method = (config.method || 'get').toLowerCase();
  const needsCsrf = ['post', 'put', 'delete', 'patch'].includes(method);
  
  if (needsCsrf) {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      config.headers['X-CSRF-Token'] = csrfToken;
    }
  }
  
  return config;
});

// Usage
await axios.post('/api/transactions', data);
```

## API Client Usage (curl, Postman, etc.)

**Good news**: API clients are automatically exempt from CSRF protection! You can make requests normally without any CSRF token:

```bash
# Works directly - no CSRF token needed for curl
curl -X POST https://your-domain.com/api/transactions \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'
```

This works because curl's User-Agent doesn't match browser patterns, so CSRF is automatically skipped.

**Note**: Your requests still need proper authentication (OAuth tokens, API keys, etc.) - only CSRF validation is bypassed.

## Testing

### Test CSRF Protection for Browser Requests

To test that CSRF works for browsers, you need to **simulate a browser User-Agent**:

1. **Test GET request with browser UA** (should set CSRF-TOKEN cookie):
```bash
curl -i -X GET https://your-domain.com/api/health \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
  -H "Cookie: strato_session=your-session-id"
```

Look for `Set-Cookie: CSRF-TOKEN=...` in the response.

2. **Test POST with browser UA but no token** (should fail):
```bash
curl -i -X POST https://your-domain.com/api/transactions \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
  -H "Cookie: strato_session=your-session-id" \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'
```

Should return `403 Forbidden` with CSRF error.

3. **Test POST with browser UA and correct token** (should succeed):
```bash
# First get the token
CSRF_TOKEN=$(curl -s -i -X GET https://your-domain.com/api/health \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
  -H "Cookie: strato_session=test-session" \
  -c /tmp/cookies.txt | grep -i "set-cookie: csrf-token" | sed 's/.*CSRF-TOKEN=\([^;]*\).*/\1/' | tr -d '\r')

# Then make the POST request
curl -i -X POST https://your-domain.com/api/transactions \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
  -H "Cookie: strato_session=test-session; CSRF-TOKEN=$CSRF_TOKEN" \
  -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'
```

Should succeed (CSRF validation passes).

4. **Test POST without browser UA** (should succeed - CSRF skipped):
```bash
# Regular curl (non-browser UA) - CSRF not required
curl -i -X POST https://your-domain.com/api/transactions \
  -H "Cookie: strato_session=your-session-id" \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'
```

Should succeed without CSRF token (but may fail auth if not properly authenticated).

## Security Considerations

### Why This Is Secure

1. **Token cannot be read by attacker's domain** - The `SameSite=Strict` flag prevents the cookie from being sent in cross-site requests
2. **Double validation** - The token must match both the cookie AND the server-stored value
3. **Session-bound** - Tokens are tied to user sessions and expire after 30 minutes
4. **Secure flag** - Tokens are only sent over HTTPS
5. **Random tokens** - Each token is 64 characters of cryptographically secure random hex

### What's Protected

✅ Prevents attackers from submitting forged requests from malicious websites  
✅ Protects browser-based state-changing operations (POST, PUT, DELETE, PATCH)  
✅ Zero backend changes required  
✅ Works with any session-based authentication  
✅ Developer-friendly: API clients (curl, Postman) automatically exempt  

### What's NOT Protected

❌ Does NOT protect against XSS attacks (use CSP headers for that)  
❌ Does NOT protect if the user's session is compromised  
❌ Does NOT protect against MITM attacks (use HTTPS/TLS for that)  
❌ Does NOT protect API-only clients (by design - they're not vulnerable to CSRF)  

## Token Lifecycle

- **Token Generation**: Automatic on first GET request to protected endpoint
- **Token Expiry**: 30 minutes (matches session idle timeout)
- **Token Refresh**: Automatic on any GET request to protected endpoint
- **Token Storage**: 
  - Client: `CSRF-TOKEN` cookie (readable by JavaScript)
  - Server: Nginx shared memory (10MB, can store ~100k tokens)

## Troubleshooting

### "CSRF protection: session required"

**Cause**: User is not logged in or session cookie is missing.

**Solution**: Ensure the session cookie (`strato_session`) is being sent with requests. Use `credentials: 'include'` in fetch options.

### "CSRF protection: invalid or missing token"

**Causes**:
1. Token not included in `X-CSRF-Token` header
2. Token cookie was deleted or expired
3. Token doesn't match cookie value
4. Server-side token expired

**Solutions**:
1. Ensure you're reading the token from cookie correctly
2. Make a GET request to refresh the token
3. Check browser dev tools for cookie presence
4. Verify the header name is exactly `X-CSRF-Token`

### Token Not Being Set

**Cause**: Not sending session cookie on GET request.

**Solution**: Ensure `credentials: 'include'` is set in fetch options, and user has an active session.

### CORS Issues

If you're making cross-origin requests, ensure your CORS configuration allows:
- Credentials: `Access-Control-Allow-Credentials: true`
- Headers: `Access-Control-Allow-Headers: X-CSRF-Token`

## Monitoring

Check nginx logs for CSRF validation failures:

```bash
grep "CSRF validation failed" /usr/local/openresty/nginx/logs/error.log
```

This helps identify:
- Potential CSRF attacks
- Frontend implementation issues
- Token expiry problems

