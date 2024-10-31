local openidc = require("resty.openidc")

local node_host_with_protocol = string.format("<REDIRECT_URI_SCHEME_PLACEHOLDER_HTTP_HTTPS>://%s/", ngx.var.http_host)

local user_access_token = ''

local verify_opts = {
  discovery = "<OAUTH_DISCOVERY_URL_PLACEHOLDER>",
  ssl_verify = "<IS_SSL_PLACEHOLDER_YES_NO>",
  accept_none_alg = false,
  accept_unsupported_alg = false
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
  ngx.header['WWW-Authenticate'] = string.format('realm="%s"', node_host_with_protocol)
  ngx.exit(ngx.HTTP_UNAUTHORIZED)
end

if user_access_token ~= '' then
  ngx.req.set_header("X-USER-ACCESS-TOKEN", user_access_token)
end
-- removing the Authorization header FROM REQUEST to prevent upstream services from using it (e.g. PostgresT's built-in JWT-based access)
ngx.req.clear_header("Authorization")

