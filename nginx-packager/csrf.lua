-- API routes with CSRF protection (Double-Submit Cookie Pattern + Server-Side Storage)
-- Safe methods (GET, HEAD, OPTIONS): Generate/refresh CSRF token and set as readable cookie
-- State-changing methods (POST, PUT, DELETE, PATCH): Require X-CSRF-Token header matching cookie value
--
-- How it works:
-- 1. On GET requests, nginx generates a random CSRF token if session cookie exists
-- 2. Token is stored server-side (in shared dict) keyed by encrypted session ID
-- 3. Token is also sent to client as a cookie (NOT HttpOnly, so JS can read it)
-- 4. Frontend reads the cookie and includes token in X-CSRF-Token header for POST/PUT/DELETE/PATCH
-- 5. Nginx validates that the header token matches both the cookie AND the server-stored token
-- 6. Each session gets its own unique token (destroyed on logout, regenerated on new login)

local _M = {}

-- Initialize CSRF module with shared dictionary reference
function _M.init(csrf_tokens_dict)
    _M.csrf_tokens = csrf_tokens_dict
end

-- Generate a secure CSRF token (64 character hex string)
function _M.generate_csrf_token()
    local resty_random = require "resty.random"
    local str = require "resty.string"
    local random_bytes = resty_random.bytes(32)
    if not random_bytes then
        ngx.log(ngx.ERR, "Failed to generate random bytes for CSRF token")
        return nil
    end
    return str.to_hex(random_bytes)
end

-- Build cookie string with appropriate flags based on connection type
function _M.build_csrf_cookie(token)
    local cookie = "CSRF-TOKEN=" .. token .. "; Path=/; SameSite=Strict"
    
    -- Only add Secure flag if using HTTPS
    -- ngx.var.https is "on" for HTTPS connections, nil for HTTP
    if ngx.var.https == "on" then
        cookie = cookie .. "; Secure"
    end
    
    return cookie
end

-- Validate CSRF token against both cookie and stored session token
function _M.validate_csrf_token(header_token, cookie_token, session_id)
    if not header_token or not cookie_token or not session_id then
        ngx.log(ngx.WARN, "CSRF validation: missing required values (header:", header_token and "present" or "missing", 
                ", cookie:", cookie_token and "present" or "missing", ", session:", session_id and "present" or "missing", ")")
        return false
    end
    
    -- Check that header matches cookie (client must be able to read cookie)
    if header_token ~= cookie_token then
        ngx.log(ngx.WARN, "CSRF validation failed: header token doesn't match cookie token")
        return false
    end
    
    -- Check that cookie matches server-stored token (prevents cookie injection)
    local stored_token = _M.csrf_tokens:get(session_id)
    if not stored_token then
        ngx.log(ngx.WARN, "CSRF validation failed: no stored token found for session (token may have expired or was never generated)")
        return false
    end
    
    if stored_token ~= cookie_token then
        ngx.log(ngx.WARN, "CSRF validation failed: cookie token doesn't match stored token (stored:", 
                stored_token and stored_token:sub(1, 16) or "nil", "..., cookie:", cookie_token:sub(1, 16), "...)")
        return false
    end
    
    return true
end


-- Get the session ID from the encrypted session cookie
-- NOTE: The session cookie is encrypted by lua-resty-session (used by openidc).
-- We use the raw encrypted cookie value as the session ID - it's unique per user
-- and stable across requests, which is all we need for CSRF token storage.
function _M.get_session_id()
    return ngx.var.cookie_strato_session
end

-- Check if request is likely from a browser (vs API client like curl/Postman)
-- Defense-in-depth: Multiple signals indicate browser request
function _M.is_browser_request()
    local user_agent = ngx.var.http_user_agent or ""
    
    -- Check 1: User-Agent contains browser indicators
    -- Note: JavaScript in browsers CANNOT modify User-Agent header (browser security policy)
    -- Historical note: Almost all browsers include "Mozilla/" for backward compatibility
    local browser_indicators = {
        "Mozilla/",   -- Covers: Chrome, Firefox, Safari, Edge, Opera, Brave, Vivaldi, Samsung Internet, and most others
        "Trident/",   -- Internet Explorer 11
        "MSIE",       -- Older Internet Explorer
    }
    
    local has_browser_ua = false
    for _, indicator in ipairs(browser_indicators) do
        if user_agent:find(indicator, 1, true) then
            has_browser_ua = true
            break
        end
    end
    
    if not has_browser_ua then
        return false  -- Definitely not a browser
    end
    
    -- Additional check: Explicitly exclude known API client patterns
    -- (Defense-in-depth in case someone sets "Mozilla/" in their API client)
    local api_client_patterns = {
        "curl/", "python%-requests/", "python%-urllib", "Go%-http%-client",
        "PostmanRuntime/", "insomnia/", "node%-fetch", "axios/",
        "okhttp/", "Java/", "Apache%-HttpClient", "Wget/",
    }
    
    for _, pattern in ipairs(api_client_patterns) do
        if user_agent:find(pattern) then
            ngx.log(ngx.INFO, "API client detected in UA: " .. user_agent)
            return false
        end
    end
    
    -- Check 2: Has Accept header typical of browsers (defense-in-depth)
    -- Browsers typically send "text/html" in Accept header for navigation
    -- But for API calls they send "application/json", so we should allow both
    local accept = ngx.var.http_accept or ""
    local has_suspicious_accept = (
        accept:find("curl", 1, true) or 
        accept:find("postman", 1, true) or
        accept == "*/*" and user_agent:find("curl", 1, true)
    )
    
    if has_suspicious_accept then
        ngx.log(ngx.INFO, "Browser-like UA but suspicious Accept header - treating as API client")
        return false
    end
    
    -- Check 3: Presence of common browser headers (Sec-Fetch-* headers)
    -- Modern browsers send Sec-Fetch-Site, Sec-Fetch-Mode, etc.
    -- These headers CANNOT be set by JavaScript (forbidden headers)
    local sec_fetch_site = ngx.var.http_sec_fetch_site
    local sec_fetch_mode = ngx.var.http_sec_fetch_mode
    
    if sec_fetch_site or sec_fetch_mode then
        -- Definitely a modern browser
        ngx.log(ngx.DEBUG, "Browser request confirmed via Sec-Fetch-* headers")
        return true
    end
    
    -- If we have browser UA but no Sec-Fetch headers, it could be:
    -- 1. Older browser that doesn't support Sec-Fetch
    -- 2. API client spoofing User-Agent (but they'd need to know the CSRF token anyway)
    -- We'll treat as browser for backward compatibility
    return true
end

-- Main CSRF protection handler for API requests
function _M.protect_api()
    local method = ngx.var.request_method
    local session_id = _M.get_session_id()
    local request_uri = ngx.var.request_uri or ""
    
    -- Skip CSRF entirely for auth endpoints (logout, login, OAuth flows)
    -- These are part of the authentication process itself
    if request_uri:find("^/auth/", 1, true) then
        ngx.log(ngx.DEBUG, "CSRF check skipped - auth endpoint")
        return
    end
    
    -- Only enforce CSRF for browser requests to maintain developer experience
    -- API clients (curl, Postman, mobile apps, etc.) are exempt
    local is_browser = _M.is_browser_request()
    
    if not is_browser then
        ngx.log(ngx.DEBUG, "CSRF check skipped - non-browser client detected")
        return
    end
    
    -- Skip CSRF for safe methods (GET, HEAD, OPTIONS) but ensure token exists
    if method == "GET" or method == "HEAD" or method == "OPTIONS" then
        if session_id then
            ngx.log(ngx.DEBUG, "CSRF: GET request, session_id: ", session_id:sub(1, 32), "...")
            local existing_token = _M.csrf_tokens:get(session_id)
            -- In nginx, CSRF-TOKEN cookie is accessed as csrf_token (lowercase, hyphen to underscore)
            local cookie_token = ngx.var.cookie_csrf_token or ngx.var["cookie_CSRF-TOKEN"]
            
            ngx.log(ngx.DEBUG, "CSRF: existing_token in shared dict: ", existing_token and existing_token:sub(1, 16) or "nil", 
                    ", cookie_token: ", cookie_token and cookie_token:sub(1, 16) or "nil")
            
            -- Always generate a new token if none exists in shared memory
            -- This ensures each session gets its own token (important after logout/login)
            -- Note: After server restart, users will get a new token on their next GET request
            if not existing_token then
                -- Generate new token for this session
                local new_token = _M.generate_csrf_token()
                if new_token then
                    -- Use add() for atomic operation - prevents race condition with parallel requests
                    local success, err, forcible = _M.csrf_tokens:add(session_id, new_token, 1800)
                    if success then
                        ngx.log(ngx.DEBUG, "CSRF: Generated and stored new CSRF token for session")
                        -- IMPORTANT: No HttpOnly flag - frontend needs to read this!
                        ngx.header["Set-Cookie"] = _M.build_csrf_cookie(new_token)
                    elseif err == "exists" then
                        -- Another parallel request already created a token, use that one
                        ngx.log(ngx.DEBUG, "CSRF: Token already exists (parallel request won the race), using existing token")
                        existing_token = _M.csrf_tokens:get(session_id)
                        if existing_token and not cookie_token then
                            -- Send the winning token to client
                            ngx.header["Set-Cookie"] = _M.build_csrf_cookie(existing_token)
                        end
                    else
                        ngx.log(ngx.ERR, "CSRF: Failed to store new CSRF token in shared dict: ", err or "unknown error")
                    end
                end
            elseif not cookie_token then
                -- Client doesn't have the cookie yet, send it
                ngx.log(ngx.DEBUG, "CSRF: Sending existing token to client (client cookie missing)")
                ngx.header["Set-Cookie"] = _M.build_csrf_cookie(existing_token)
            else
                -- Client already has the correct cookie, no need to send Set-Cookie header
                ngx.log(ngx.DEBUG, "CSRF: Client already has valid token cookie, skipping Set-Cookie header")
            end
        else
            ngx.log(ngx.DEBUG, "CSRF: GET request but no session_id found")
        end
        return
    end
    
    -- For state-changing methods, validate CSRF token
    if method == "POST" or method == "PUT" or method == "DELETE" or method == "PATCH" then
        -- In nginx, X-CSRF-Token header is accessed as http_x_csrf_token (lowercase, hyphen to underscore)
        local header_token = ngx.var.http_x_csrf_token
        -- In nginx, CSRF-TOKEN cookie is accessed as csrf_token (lowercase, hyphen to underscore)
        local cookie_token = ngx.var.cookie_csrf_token or ngx.var["cookie_CSRF-TOKEN"]
        
        ngx.log(ngx.DEBUG, "CSRF: " .. method .. " request to " .. ngx.var.request_uri)
        ngx.log(ngx.DEBUG, "CSRF: session_id: ", session_id and session_id:sub(1, 32) or "nil", "...")
        ngx.log(ngx.DEBUG, "CSRF: header_token: ", header_token and header_token:sub(1, 16) or "nil", "...")
        ngx.log(ngx.DEBUG, "CSRF: cookie_token: ", cookie_token and cookie_token:sub(1, 16) or "nil", "...")
        
        -- Check session exists
        if not session_id then
            ngx.log(ngx.WARN, "CSRF validation failed: No session ID for " .. method .. " request to " .. ngx.var.request_uri)
            ngx.status = 403
            ngx.header.content_type = "application/json"
            ngx.say('{"error": "Authentication required. Please log in and try again."}')
            ngx.exit(403)
            return
        end
        
        -- Check what's actually stored in shared dict
        local stored_token = _M.csrf_tokens:get(session_id)
        ngx.log(ngx.DEBUG, "CSRF: stored_token in shared dict: ", stored_token and stored_token:sub(1, 16) or "nil", "...")
        
        -- Validate token (header must match cookie AND server-stored token)
        if not _M.validate_csrf_token(header_token, cookie_token, session_id) then
            ngx.log(ngx.WARN, "CSRF validation failed for " .. method .. " request to " .. ngx.var.request_uri .. 
                    " from " .. (ngx.var.remote_addr or "unknown") .. 
                    " (session: " .. (session_id or "none") .. ")")
            ngx.status = 403
            ngx.header.content_type = "application/json"
            -- Generic error message - token may have expired or session changed
            ngx.say('{"error": "Security validation failed. Please refresh the page and try again."}')
            ngx.exit(403)
            return
        end
        
        ngx.log(ngx.INFO, "CSRF: ✅ Token validation successful for " .. method .. " request to " .. ngx.var.request_uri)
    end
end

-- Check if this file is being executed directly (via rewrite_by_lua_file)
-- or being required as a module (via require)
if csrf and csrf.protect_api then
    -- File is being executed directly via rewrite_by_lua_file
    -- The 'csrf' global variable exists from init_by_lua
    csrf.protect_api()
else
    -- File is being required as a module, return the module table
    return _M
end
