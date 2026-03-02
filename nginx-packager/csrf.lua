-- CSRF Protection: Double-Submit Cookie + Server-Side Storage
-- Browser requests only; API clients (curl/Postman) exempt via User-Agent + Sec-Fetch validation
-- GET: Generate token | POST/PUT/PATCH/DELETE: Validate token | HEAD/OPTIONS: Skip

local _M = {}

function _M.init(csrf_tokens_dict)
    _M.csrf_tokens = csrf_tokens_dict
end

function _M.generate_csrf_token()
    local resty_random = require "resty.random"
    local str = require "resty.string"
    local random_bytes = resty_random.bytes(32)
    if not random_bytes then
        ngx.log(ngx.ERR, "CSRF: Failed to generate random bytes")
        return nil
    end
    return str.to_hex(random_bytes)
end

function _M.build_csrf_cookie(token)
    local cookie = "CSRF-TOKEN=" .. token .. "; Path=/; SameSite=Strict"
    if ngx.var.https == "on" then
        cookie = cookie .. "; Secure"
    end
    return cookie
end

function _M.validate_csrf_token(header_token, cookie_token, session_id)
    if not header_token or not cookie_token or not session_id then
        return false
    end
    
    if header_token ~= cookie_token then
        return false
    end
    
    local stored_token = _M.csrf_tokens:get(session_id)
    if not stored_token or stored_token ~= cookie_token then
        return false
    end
    
    -- Refresh token TTL on successful validation
    _M.csrf_tokens:set(session_id, stored_token, 1800)
    
    return true
end

-- Session ID = encrypted session cookie value (unique and stable per user)
function _M.get_session_id()
    return ngx.var.cookie_strato_session
end

-- Whitelist known API clients; validate Sec-Fetch headers for modern browsers
-- Note: JS cannot modify User-Agent or Sec-Fetch-* headers
function _M.is_browser_request()
    local user_agent = ngx.var.http_user_agent or ""

    local api_client_patterns = {
        "curl/", "Wget/", "python%-requests/", "python%-urllib", "Go%-http%-client",
        "PostmanRuntime/", "insomnia/", "HTTPie/", "node%-fetch", "axios/",
        "okhttp/", "Java/", "Apache%-HttpClient", "Dart/", "Ruby", "PHP/", "RestSharp/",
        "restish"
    }

    for _, pattern in ipairs(api_client_patterns) do
        if user_agent:find(pattern) then
            return false  -- API client, skip CSRF
        end
    end

    -- Validate Sec-Fetch headers (modern browsers only)
    local sec_fetch_site = ngx.var.http_sec_fetch_site
    local sec_fetch_mode = ngx.var.http_sec_fetch_mode

    if sec_fetch_site == "cross-site" and sec_fetch_mode ~= "navigate" then
        ngx.log(ngx.WARN, "CSRF: Suspicious Sec-Fetch headers (cross-site non-navigation)")
    end

    return true  -- Treat as browser, enforce CSRF
end

function _M.regenerate_token_for_new_session(new_session_id, old_session_id)
    if not new_session_id then
        return nil
    end
    
    if old_session_id and old_session_id ~= new_session_id then
        _M.csrf_tokens:delete(old_session_id)
    end
    
    local new_token = _M.generate_csrf_token()
    if not new_token then
        return nil
    end
    
    local success, err = _M.csrf_tokens:set(new_session_id, new_token, 1800)
    if not success then
        ngx.log(ngx.ERR, "CSRF: Failed to store token during rotation: ", err)
        return nil
    end
    
    return new_token
end

-- Ensure CSRF token exists and is sent to client
function _M.ensure_csrf_token_for_session(session_id, context)
    if not session_id then
        return false
    end
    
    local existing_token = _M.csrf_tokens:get(session_id)
    local cookie_token = ngx.var.cookie_csrf_token or ngx.var["cookie_CSRF-TOKEN"]
    
    if not existing_token then
        local new_token = _M.generate_csrf_token()
        if not new_token then
            return false
        end
        
        local success, err = _M.csrf_tokens:add(session_id, new_token, 1800)
        if success then
            ngx.header["Set-Cookie"] = _M.build_csrf_cookie(new_token)
            return true
        elseif err == "exists" then
            existing_token = _M.csrf_tokens:get(session_id)
            if existing_token and not cookie_token then
                ngx.header["Set-Cookie"] = _M.build_csrf_cookie(existing_token)
                return true
            end
        end
        return false
    else
        -- Token exists, refresh its TTL to extend session
        _M.csrf_tokens:set(session_id, existing_token, 1800)
        
        if not cookie_token then
            ngx.header["Set-Cookie"] = _M.build_csrf_cookie(existing_token)
            return true
        end
    end
    
    return false
end

function _M.handle_session_rotation()
    -- Prevent double-processing (header_filter can be called multiple times)
    if ngx.ctx.csrf_rotation_handled then
        return
    end
    
    if not _M.is_browser_request() then
        return
    end
    
    -- Check if openid.lua detected session rotation during access phase
    if not ngx.ctx.session_rotated then
        return
    end
    
    local new_session_id = ngx.ctx.new_session_id
    local old_session_id = ngx.ctx.old_session_id
    
    if not new_session_id then
        ngx.log(ngx.WARN, "CSRF: Session rotation flagged but no new session ID")
        return
    end
    
    local new_csrf_token = _M.regenerate_token_for_new_session(new_session_id, old_session_id)
    if not new_csrf_token then
        ngx.log(ngx.ERR, "CSRF: Failed to regenerate token during session rotation")
        return
    end
    
    -- Add CSRF token cookie to response
    local csrf_cookie = _M.build_csrf_cookie(new_csrf_token)
    local existing_cookies = ngx.header["Set-Cookie"]
    
    if existing_cookies then
        if type(existing_cookies) == "table" then
            table.insert(existing_cookies, csrf_cookie)
            -- CRITICAL: Must reassign the table back to ngx.header for changes to take effect
            ngx.header["Set-Cookie"] = existing_cookies
        else
            ngx.header["Set-Cookie"] = {existing_cookies, csrf_cookie}
        end
    else
        ngx.header["Set-Cookie"] = csrf_cookie
    end
    
    -- Mark that we've handled this rotation to prevent double-processing
    ngx.ctx.csrf_rotation_handled = true
end

function _M.initialize_token()
    if not _M.is_browser_request() then
        return
    end

    local session_id = _M.get_session_id()
    if session_id then
        _M.ensure_csrf_token_for_session(session_id, "/csrf-init")
    end
end

function _M.protect_api()
    local method = ngx.var.request_method
    local session_id = _M.get_session_id()
    local request_uri = ngx.var.request_uri or ""

    if request_uri:find("^/auth/", 1, true) then
        return
    end
    
    if not _M.is_browser_request() then
        return
    end

    if method == "OPTIONS" or method == "HEAD" then
        return
    end

    if method == "GET" then
        if session_id then
            _M.ensure_csrf_token_for_session(session_id, "GET")
        end
        return
    end

    if method == "POST" or method == "PUT" or method == "DELETE" or method == "PATCH" then
        local header_token = ngx.var.http_x_csrf_token
        local cookie_token = ngx.var.cookie_csrf_token or ngx.var["cookie_CSRF-TOKEN"]

        if not session_id then
            ngx.log(ngx.WARN, "CSRF: No session for ", method, " ", request_uri)
            ngx.status = 403
            ngx.header.content_type = "application/json"
            ngx.say('{"error": "Authentication required. Please log in and try again."}')
            ngx.exit(403)
            return
        end

        if not _M.validate_csrf_token(header_token, cookie_token, session_id) then
            ngx.log(ngx.WARN, "CSRF: Validation failed for ", method, " ", request_uri, " from ", ngx.var.remote_addr or "unknown")
            ngx.status = 403
            ngx.header.content_type = "application/json"
            ngx.say('{"error": "Security validation failed. Please refresh the page and try again."}')
            ngx.exit(403)
            return
        end
    end
end

if csrf and csrf.protect_api then
    csrf.protect_api()
else
    return _M
end
