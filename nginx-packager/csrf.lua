-- API routes with CSRF protection
-- Safe methods (GET, HEAD, OPTIONS): Generate/refresh CSRF token and set as HttpOnly cookie
-- State-changing methods (POST, PUT, DELETE, PATCH): Require X-CSRF-Token header matching session token

local _M = {}

-- Initialize CSRF module with shared dictionary reference
function _M.init(csrf_tokens_dict)
    _M.csrf_tokens = csrf_tokens_dict
end

-- Generate a secure CSRF token
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

-- Validate CSRF token against stored session token
function _M.validate_csrf_token(token, session_id)
    if not token or not session_id then
        return false
    end
    local stored_token = _M.csrf_tokens:get(session_id)
    return stored_token and stored_token == token
end

-- Store CSRF token for session (30 minutes expiry)
function _M.set_csrf_token(session_id, token)
    if session_id and token then
        _M.csrf_tokens:set(session_id, token, 1800)
    end
end

-- Main CSRF protection handler for API requests
function _M.protect_api()
    local method = ngx.var.request_method
    local session_id = ngx.var.session_name and ngx.var.cookie_strato_session
    
    -- Skip CSRF for safe methods (GET, HEAD, OPTIONS) but ensure token exists
    if method == "GET" or method == "HEAD" or method == "OPTIONS" then
        if session_id then
            local existing_token = _M.csrf_tokens:get(session_id)
            if not existing_token then
                local new_token = _M.generate_csrf_token()
                if new_token then
                    _M.set_csrf_token(session_id, new_token)
                    ngx.header["Set-Cookie"] = "CSRF-TOKEN=" .. new_token .. "; Path=/; HttpOnly; Secure; SameSite=Strict"
                end
            else
                ngx.header["Set-Cookie"] = "CSRF-TOKEN=" .. existing_token .. "; Path=/; HttpOnly; Secure; SameSite=Strict"
            end
        end
        return
    end
    
    -- For state-changing methods, validate CSRF token
    if method == "POST" or method == "PUT" or method == "DELETE" or method == "PATCH" then
        local csrf_token = ngx.var.http_x_csrf_token
        
        if not session_id then
            ngx.log(ngx.WARN, "CSRF validation failed: No session ID for " .. method .. " request to " .. ngx.var.request_uri)
            ngx.status = 403
            ngx.say('{"error": "CSRF protection: session required"}')
            ngx.exit(403)
            return
        end
        
        if not _M.validate_csrf_token(csrf_token, session_id) then
            ngx.log(ngx.WARN, "CSRF validation failed for " .. method .. " request to " .. ngx.var.request_uri .. " from " .. (ngx.var.remote_addr or "unknown"))
            ngx.status = 403
            ngx.say('{"error": "CSRF protection: invalid or missing token"}')
            ngx.exit(403)
            return
        end
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
