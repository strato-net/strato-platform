local openidc = require("resty.openidc")

local verify_opts = {
  discovery = "<OAUTH_DISCOVERY_URL_PLACEHOLDER>",
  ssl_verify = "<IS_SSL_PLACEHOLDER_YES_NO>",
  accept_none_alg = false,
  accept_unsupported_alg = false
}

-- Clear any x-user-access-token header coming from the client, for security reasons
ngx.req.clear_header("X-USER-ACCESS-TOKEN")

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
  ngx.status = 401
  ngx.say("No Authorization header is provided with the request.")
  ngx.exit(ngx.HTTP_UNAUTHORIZED)
end

if user_access_token ~= '' then
  ngx.req.set_header("X-USER-ACCESS-TOKEN", user_access_token)
end

-- removing the Authorization header FROM REQUEST to prevent downstream services from using it by mistake.
ngx.req.clear_header("Authorization")
