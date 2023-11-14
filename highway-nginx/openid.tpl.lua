-- for openid reference see https://github.com/zmartzone/lua-resty-openidc


--TODO: update steps:

-- This Lua script supports two request types:
-- 1. access_token provided directly in Authorization header (OAuth2 authorization flow happens on the third-party application side) -
--    the token is being verified and we either authorize the request or exit with 403
-- 2. Nginx session-based OAuth2 (for SMD and API calls from browser; uses STRATO client id and secret):
--    if no session provided in request OR session is expired OR access token in session is expired on invalid:
--      - if UI call (SMD, i.e. "/dashboard/..") - redirect to OAuth2 provider sign-in page, then redirect back to the requested page (without hash part of url);
--      - if API call - return 401 Unauthorized with WWW-Authenticate header
--    if valid session is in request and has valid access token - request is authorized
--
-- Note Access token has a "slack" time of 120 sec (default) after access token or session is expired (see for `iat_slack` param in opts)


local openidc = require("resty.openidc")

local function isEmpty(s)
  return s == nil or s == ''
end

local node_host_with_protocol = string.format("<REDIRECT_URI_SCHEME_PLACEHOLDER_HTTP_HTTPS>://%s/", ngx.var.http_host)

local id_provider = ''
local unique_name = ''
local user_access_token = ''
local verify_res = ''
local verify_err = ''

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
  logout_path = "/auth/logout",
  post_logout_redirect_uri = node_host_with_protocol,
  -- redirect_after_logout_uri = "/", -- URI to redirect after app and oauth provider logouts, otherwise show "Logged Out" text message on logout_path URI
  revoke_tokens_on_logout = true
}

-- If it is a direct call to APIs (with access_token provided as Bearer token in Authorization header)
if ngx.req.get_headers()["Authorization"] then
  verify_res, verify_err = openidc.bearer_jwt_verify(verify_opts)

  if verify_err or not verify_res then
    ngx.status = 403
    ngx.say("Authorization header is provided but the bearer token is invalid or expired: " .. (verify_err or 'unknown error'))
    ngx.exit(ngx.HTTP_FORBIDDEN)
  end

  -- Token from Authorization header is verified at this point - can blindly get raw token from header by dropping "Bearer " prefix
  local header = ngx.req.get_headers()["Authorization"]
  local divider = header:find(' ')
  user_access_token = header:sub(divider + 1)

  if verify_res['iss'] ~= nil then
    id_provider = verify_res['iss']
  end

  if verify_res['sub'] ~= nil then
    unique_name = verify_res['sub']
  end

else
  ngx.status = 401
  ngx.say("No Authorization header is provided with the request.")
  ngx.exit(ngx.HTTP_UNAUTHORIZED)
end

if user_access_token ~= '' then
  ngx.req.set_header("X-USER-ACCESS-TOKEN", user_access_token)
end

if id_provider ~= '' then
  ngx.req.set_header("X-IDENTITY-PROVIDER-ID", id_provider)
end

if unique_name ~= '' then
  ngx.req.set_header("X-USER-UNIQUE-NAME", unique_name)
end
-- removing the Authorization header FROM REQUEST to prevent upstream services from using it (e.g. PostgresT's built-in JWT permissioning)
ngx.req.clear_header("Authorization")
