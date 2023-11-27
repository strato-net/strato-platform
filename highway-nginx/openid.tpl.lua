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

local verify_res = ''
local verify_err = ''

local verify_opts = {
  discovery = "<OAUTH_DISCOVERY_URL_PLACEHOLDER>",
  ssl_verify = "<IS_SSL_PLACEHOLDER_YES_NO>",
  accept_none_alg = false,
  accept_unsupported_alg = false
}

-- If it is a direct call to APIs (with access_token provided as Bearer token in Authorization header)
if ngx.req.get_headers()["Authorization"] then
  verify_res, verify_err = openidc.bearer_jwt_verify(verify_opts)

  if verify_err or not verify_res then
    ngx.status = 403
    ngx.say("Authorization header is provided but the bearer token is invalid or expired: " .. (verify_err or 'unknown error'))
    ngx.exit(ngx.HTTP_FORBIDDEN)
  end

else
  ngx.status = 401
  ngx.say("No Authorization header is provided with the request.")
  ngx.exit(ngx.HTTP_UNAUTHORIZED)
end

-- removing the Authorization header FROM REQUEST to prevent upstream services from using it (e.g. PostgresT's built-in JWT permissioning)
ngx.req.clear_header("Authorization")
