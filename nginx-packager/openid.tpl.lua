local openidc = require("resty.openidc")

local node_host_with_protocol = string.format("<REDIRECT_URI_SCHEME_PLACEHOLDER_HTTP_HTTPS>://%s/", ngx.var.http_host)

local unique_name = ''
local user_access_token = ''

local verify_opts = {
  discovery = "<OAUTH_DISCOVERY_URL_PLACEHOLDER>",
  ssl_verify = "<IS_SSL_PLACEHOLDER_YES_NO>",
  accept_none_alg = false,
  accept_unsupported_alg = false
}

local authenticate_opts = {
  redirect_uri = "/auth/openidc/return",
  discovery = "<OAUTH_DISCOVERY_URL_PLACEHOLDER>",
  client_id = "<CLIENT_ID_PLACEHOLDER>",
  client_secret = "<CLIENT_SECRET_PLACEHOLDER>",
  scope = "<OAUTH_SCOPE_PLACEHOLDER>",
  token_endpoint_auth_method = "client_secret_post",
  ssl_verify = "<IS_SSL_PLACEHOLDER_YES_NO>",
  redirect_uri_scheme = "<REDIRECT_URI_SCHEME_PLACEHOLDER_HTTP_HTTPS>",
  -- 'id_token' to get user data; 'access_token' for access and refresh tokens; 'user' to get additional user data (some providers include 'email' in user object instead of id_token)
  session_contents = {access_token=true}, -- comment out to keep everything; other options: user=true, id_token=true, enc_id_token=true
  renew_access_token_on_expiry = true,
  access_token_expires_in = 300,
  access_token_expires_leeway = 3,
  logout_path = "/auth/logout",
  post_logout_redirect_uri = node_host_with_protocol,
  -- redirect_after_logout_uri = "/", -- URI to redirect after app and oauth provider logouts, otherwise show "Logged Out" text message on logout_path URI
  revoke_tokens_on_logout = true
}

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

  local authenticate_res, authenticate_err
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
    authenticate_res, authenticate_err = openidc.authenticate(authenticate_opts, nil, "deny")
    if (authenticate_res == nil or authenticate_err ~= nil) then
      if (authenticate_err ~= nil) then
        ngx.log(ngx.DEBUG, 'User authentication error: ', authenticate_err)
      end
      -- Let client know in the response that client is not (or no longer) authenticated (so that the UI could notify user that he's been signed out)
      ngx.header['WWW-Authenticate'] = string.format('realm="%s"', node_host_with_protocol)
      -- Respond with 401 Unauthorized if the requested endpoint does not allow anonymous access
      if (ngx.var.allow_optional_anon_access ~= "true") then
        -- respond with 401 if not authorized (if API called by UI client (e.g. SMD) - client should refresh page)
        ngx.exit(ngx.HTTP_UNAUTHORIZED)
      end
    end
  end

  if authenticate_res ~= nil and authenticate_res.access_token then
    user_access_token = authenticate_res.access_token
  else
    -- not expected to get here if not allow_optional_anon_access
    if ngx.var.allow_optional_anon_access ~= "true" then
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
-- removing the Authorization header FROM REQUEST to prevent upstream services from using it (e.g. PostgresT's built-in JWT-based access)
ngx.req.clear_header("Authorization")
