-- for openid reference see https://github.com/zmartzone/lua-resty-openidc

-- This Lua script supports two request types:
-- 1. access_token provided directly in Authorization header (OAuth2 authorization flow happens on the third-party application side) -
--    the token is being verified and either authorizes the request or exits with 403
-- 2. Nginx session-based OAuth2 (for SMD and API calls from browser; uses STRATO client id and secret):
--    if no session provided in request OR session is expired OR access token in session is expired on invalid:
--      - if UI call (SMD, i.e. "/dashboard/..") - redirect to OAuth2 provider sign-in page, then redirect back to the requested page (without hash part of url);
--      - if API call - return 401 Unauthorized
--    if valid session is in request and has valid access token - request is authorized
-- Flow (1) is used when Authorization header is provided in the request.
-- Access token has a slack time of 120 sec (default) after access token or session is expired (see for `iat_slack` param in opts)


local openidc = require("resty.openidc")

local function isEmpty(s)
  return s == nil or s == ''
end

-- Which property of access token payload to use as STRATO account name
local username_property = "<OAUTH_JWT_USERNAME_PROPERTY_PLACEHOLDER>"

local node_host_with_protocol = string.format("<REDIRECT_URI_SCHEME_PLACEHOLDER_HTTP_HTTPS>://%s/", ngx.var.http_host)

local unique_name = ''

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
  --session_contents = {id_token=true, enc_id_token=true, user=true, access_token=true}, -- comment out to keep everything
  renew_access_token_on_expiry = true,
  access_token_expires_in = 300,
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

  if not isEmpty(verify_res[username_property]) then
    unique_name = verify_res[username_property]
  else
    unique_name = verify_res.appid
  end

else
  -- Else - use the openidc authenticate flow
  if "<OAUTH_TEMPORARY_MIXED_AUTH>" == "true" then
    -- This is a request coming from a legacy unit tests, leave it alone.
    return
  end

  -- If it's the logout request - unset custom cookies. All the rest is handled by .authenticate()
  if ngx.var.request_uri == authenticate_opts.logout_path then
    ngx.header['Set-Cookie'] = 'strato_user_name=""; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
  end

  local authenticate_res, authenticate_err
  -- if requested_uri is the UI page (like SMD) or the API call
  if ngx.var.is_ui == "true" then
    -- authenticate with full flow - authenticate() handles authorization, all OAuth2 redirects, sessions, logout flow;
    -- processes the OAuth2 sign-in and token exchange redirects until the request is completely authorized, or there is an error
    authenticate_res, authenticate_err = openidc.authenticate(authenticate_opts)
  else
    -- only validate the session, do not redirect, respond with 401 if not authorized (if API called by UI client (e.g. SMD) - client should refresh page)
    authenticate_res, authenticate_err = openidc.authenticate(authenticate_opts, nil, "pass")
    if (authenticate_res == authenticate_err and authenticate_res == nil) then
      ngx.header['WWW-Authenticate'] = string.format('realm="%s"', node_host_with_protocol)
      ngx.exit(ngx.HTTP_UNAUTHORIZED)
    end
  end

  -- in case of internal server error
  if authenticate_err then
    ngx.status = 500
    ngx.header['Set-Cookie'] = 'strato_user_name=""; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
    ngx.say(authenticate_err)
    ngx.exit(ngx.HTTP_INTERNAL_SERVER_ERROR)
  end

  -- Request is authorized at this point - prepare data
  if not isEmpty(authenticate_res.id_token[username_property]) then
    unique_name = authenticate_res.id_token[username_property]
  else
    if not isEmpty(authenticate_res.id_token.appid) then
      unique_name = authenticate_res.id_token.appid
    else
      -- None of the two expected properties found in id_token
      ngx.status = 500
      ngx.header['Set-Cookie'] = 'strato_user_name=""; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
      user_err_msg = 'Could not authenticate the request. STRATO nginx is likely misconfigured.'
      ngx.log(ngx.STDERR, user_err_msg .. ' Error details: Failed to find claims \''..username_property..'\' and \'appid\' in payload of id_token obtained with openidc.authenticate(). Possible reason: OAUTH_SCOPE does not have the required scope for \''..username_property..'\' claim (current scope value: \''..authenticate_opts.scope..'\')')
      ngx.say(user_err_msg..' Please contact STRATO node administrator.')
      ngx.exit(ngx.HTTP_INTERNAL_SERVER_ERROR)
    end
  end

  -- set the username cookie on client
  if not ngx.var['cookie_strato_user_name'] or ngx.var['cookie_strato_user_name'] ~= unique_name then
    ngx.header['Set-Cookie'] = string.format('strato_user_name=%s; path=/', unique_name)
  end
end

-- set request headers to forward to APIs
ngx.req.set_header("X-USER-UNIQUE-NAME", unique_name)
-- removing the Authorization header FROM REQUEST to prevent Postgrest's built-in JWT permissioning to trigger
ngx.req.clear_header("Authorization")
