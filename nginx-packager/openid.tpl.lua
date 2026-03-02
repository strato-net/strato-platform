local openidc = require("resty.openidc")
local cjson = require("cjson.safe")

local node_host_with_protocol = string.format("<REDIRECT_URI_SCHEME_PLACEHOLDER_HTTP_HTTPS>://%s/", ngx.var.http_host)

-- Request correlation: use incoming X-Request-ID or nginx request_id, and echo back in response
local req_id = ngx.var.http_x_request_id or ngx.var.request_id or ("lua-" .. tostring(ngx.now()):gsub("%.", "-"))
ngx.req.set_header("X-Request-ID", req_id)

-- Safe JWT exp extraction (no token or claims logged)
local function jwt_exp_from_token(token)
  if not token or type(token) ~= "string" then return nil end
  local parts = {}
  for part in string.gmatch(token, "[^.]+") do parts[#parts + 1] = part end
  if #parts < 2 then return nil end
  local payload_b64 = parts[2]:gsub("-", "+"):gsub("_", "/")
  local pad = #payload_b64 % 4
  if pad > 0 then payload_b64 = payload_b64 .. string.rep("=", 4 - pad) end
  local ok, decoded = pcall(ngx.decode_base64, payload_b64)
  if not ok or not decoded then return nil end
  local payload = cjson.decode(decoded)
  return payload and payload.exp
end

-- Safe auth debug log: req_id, is_ui, has_access_token, has_refresh_token, expires_in, now, exp, delta_to_exp
local function log_auth_state(res, access_token_value)
  local now_ts = os.time()
  local has_access = res and res.access_token and res.access_token ~= ""
  local has_refresh = res and res.refresh_token and res.refresh_token ~= ""
  local expires_in = (res and (res.access_token_expires_in or res.expires_in)) or "nil"
  local exp = (access_token_value and jwt_exp_from_token(access_token_value)) or nil
  local delta = (exp and (exp - now_ts)) or "nil"
  ngx.log(ngx.INFO, "openidc_auth req_id=", req_id,
    " is_ui=", ngx.var.is_ui or "nil",
    " has_access_token=", tostring(has_access),
    " has_refresh_token=", tostring(has_refresh),
    " expires_in=", tostring(expires_in),
    " now=", now_ts,
    " exp=", exp or "nil",
    " delta_to_exp=", tostring(delta))
end

local unique_name = ''
local user_access_token = ''

local verify_opts = {
  discovery = "<OAUTH_DISCOVERY_URL_PLACEHOLDER>",
  ssl_verify = "<IS_SSL_PLACEHOLDER_YES_NO>",
  accept_none_alg = false,
  accept_unsupported_alg = false
}

-- Capture theme param from URL to pass to Keycloak
local theme = ngx.var.arg_theme
local auth_params = (theme == "dark" or theme == "light") and { theme = theme } or nil

local authenticate_opts = {
  redirect_uri = "/auth/openidc/return",
  discovery = "<OAUTH_DISCOVERY_URL_PLACEHOLDER>",
  client_id = "<CLIENT_ID_PLACEHOLDER>",
  client_secret = "<CLIENT_SECRET_PLACEHOLDER>",
  scope = "<OAUTH_SCOPE_PLACEHOLDER>",
  token_endpoint_auth_method = "client_secret_post",
  ssl_verify = "<IS_SSL_PLACEHOLDER_YES_NO>",
  redirect_uri_scheme = "<REDIRECT_URI_SCHEME_PLACEHOLDER_HTTP_HTTPS>",
  -- 'id_token' to get user data; 'access_token' for access and refresh tokens; 'user' to get additional user data (some providers include 'email' in user object instead of id_token), enc_id_token (required for https://openid.net/specs/openid-connect-rpinitiated-1_0.html, strictly followed by Keycloak 26.0.2+)
  session_contents = {access_token=true, enc_id_token=true}, -- comment out to keep everything
  renew_access_token_on_expiry = true,
  access_token_expires_in = 300,
  access_token_expires_leeway = 3,
  logout_path = "/auth/logout",
  post_logout_redirect_uri = node_host_with_protocol,
  -- redirect_after_logout_uri = "/", -- URI to redirect after app and oauth provider logouts, otherwise show "Logged Out" text message on logout_path URI
  revoke_tokens_on_logout = true,
  use_pkce = true,
  authorization_params = auth_params
}

-- Clear any x-user-access-token header coming from the client, for security reasons
ngx.req.clear_header("X-USER-ACCESS-TOKEN")

-- If it is a direct call to APIs (with access_token provided as Bearer token in Authorization header)
if ngx.req.get_headers()["Authorization"] then
  local verify_res, verify_err = openidc.bearer_jwt_verify(verify_opts)

  if verify_err or not verify_res then
    ngx.status = 403
    ngx.say("Authorization header is provided but the bearer token is invalid or expired: " .. (verify_err or 'unknown error'))
    ngx.exit(ngx.HTTP_FORBIDDEN)
  end

  -- Token from Authorization header is verified at this point - can blindly get raw token from header by dropping "Bearer " prefix
  local header = ngx.req.get_headers()["Authorization"]
  local divider = header:find(' ')
  user_access_token = header:sub(divider + 1)
else
  -- Else - use the openidc authenticate flow

  local authenticate_res, authenticate_err, authenticate_session
  -- Allow anonymous access only for safe/read-only methods on endpoints that explicitly allow it
  local method = ngx.req.get_method()
  local allow_anonymous_request = ngx.var.allow_optional_anon_access == "true" and (method == "GET" or method == "HEAD" or method == "OPTIONS")
  -- if requested_uri is the UI page (like SMD), else the API call
  if ngx.var.is_ui == "true" then
    -- authenticate with browser UI flow (Authorization Code grant, token exchange) - authenticate(opts) with no additional params will 302-Redirect if unauthorized
    authenticate_res, authenticate_err = openidc.authenticate(authenticate_opts)
    -- Should not get err here, if we do - server is misconfigured (most likely the opts{} is invalid). In other cases either no error or 302-redirect to login.
    if (authenticate_err) then
      ngx.status = 500
      ngx.log(ngx.ERR, 'Unexpected error #1003: authenticate_err=', authenticate_err)
      ngx.say('Unexpected server error occurred during authentication (#1001)')
      ngx.exit(ngx.HTTP_INTERNAL_SERVER_ERROR)
    end
  else
    -- only validate the session (do not redirect automatically for Auth Code Grant flow)
    -- 4th return value is the session object, needed to detect dead refresh tokens below
    authenticate_res, authenticate_err, _, authenticate_session = openidc.authenticate(authenticate_opts, nil, "deny")
    if (authenticate_res == nil or authenticate_err ~= nil) then
      if (authenticate_err ~= nil) then
        ngx.log(ngx.DEBUG, 'User authentication error: ', authenticate_err)
      end

      -- If the session had a refresh token but authenticate() still failed, the
      -- refresh token is dead. Destroy the session to prevent every subsequent
      -- request from retrying it and flooding Keycloak with REFRESH_TOKEN_ERROR.
      -- We check session state because lua-resty-openidc swallows the token
      -- endpoint error (sets err=nil) and returns generic "unauthorized request".
      if authenticate_session
          and authenticate_session.data
          and authenticate_session.data.authenticated
          and authenticate_session.data.refresh_token
      then
        ngx.log(ngx.DEBUG, "Destroying stale session due to failed token refresh: ", authenticate_err)
        authenticate_session:destroy()
      end

      -- Handle OIDC callback state mismatch (multi-tab race condition):
      -- When multiple tabs initiate auth flows, each overwrites the OIDC state in the shared
      -- session cookie. The tab whose callback arrives with the old state gets this error.
      -- Recovery: destroy the stale session and redirect to start a fresh auth flow.
      -- Since Keycloak already has an active SSO session, the user won't need to re-enter credentials.
      local args = ngx.req.get_uri_args()
      if ngx.var.uri == authenticate_opts.redirect_uri
          and args.code
          and authenticate_err
          and string.find(authenticate_err, "does not match state restored from session", 1, true)
      then
        ngx.log(ngx.WARN, "OIDC state mismatch on callback (multi-tab race condition), restarting auth flow: ", authenticate_err)
        local session = require("resty.session").open()
        if session then
          session:destroy()
        end
        return ngx.redirect("/")
      end

      -- Let client know in the response that client is not (or no longer) authenticated (so that the UI could notify user that he's been signed out)
      ngx.header['WWW-Authenticate'] = string.format('realm="%s"', node_host_with_protocol)
      if not allow_anonymous_request then
        -- respond with 401 if not authorized (if API called by UI client (e.g. SMD) - client should refresh page)
        ngx.exit(ngx.HTTP_UNAUTHORIZED)
      end
    end
  end

  if authenticate_res ~= nil and authenticate_res.access_token then
    user_access_token = authenticate_res.access_token
    log_auth_state(authenticate_res, user_access_token)
  else
    if authenticate_res == nil and authenticate_err then
      ngx.log(ngx.INFO, "openidc_auth req_id=", req_id, " is_ui=", ngx.var.is_ui or "nil", " auth_failed=1 err=", authenticate_err or "nil")
    end
    -- not expected to get here if anonymous access is not allowed for this request
    if not allow_anonymous_request then
      ngx.status = 500
      ngx.log(ngx.ERR, 'Unexpected error: not expected to be here if the endpoint does not allow anonymous access')
      ngx.say('Unexpected server error occurred during authentication (#1010)')
      ngx.exit(ngx.HTTP_INTERNAL_SERVER_ERROR)
    end
  end
end

if user_access_token ~= '' then
  ngx.req.set_header("X-USER-ACCESS-TOKEN", user_access_token)
end

-- Echo request id in response for client-side correlation with logs
ngx.header["X-Request-ID"] = req_id

-- Check if session was rotated during authentication and mark for CSRF token regeneration
local old_session_id = ngx.var.cookie_strato_session
local set_cookie_header = ngx.header["Set-Cookie"]

if set_cookie_header then
  local cookies = type(set_cookie_header) == "table" and set_cookie_header or {set_cookie_header}
  for _, cookie in ipairs(cookies) do
    local new_session_id = cookie:match("^strato_session=([^;]+)")
    if new_session_id and new_session_id ~= old_session_id then
      -- Session rotated, store info for CSRF handler in header_filter phase
      ngx.ctx.session_rotated = true
      ngx.ctx.new_session_id = new_session_id
      ngx.ctx.old_session_id = old_session_id
      break
    end
  end
end

-- removing the Authorization header FROM REQUEST to prevent upstream services from using it (e.g. PostgresT's built-in JWT-based access)
ngx.req.clear_header("Authorization")
