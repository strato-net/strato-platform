local openidc = require("resty.openidc")

local node_host_with_protocol = string.format("<REDIRECT_URI_SCHEME_PLACEHOLDER_HTTP_HTTPS>://%s/", ngx.var.http_host)

local unique_name = ''
local common_name = ''
local email = ''
local user_access_token = ''
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
    ngx.exit(ngx.HTTP_UNAUTHORIZED)
  end

  -- Token from Authorization header is verified at this point - can blindly get raw token from header by dropping "Bearer " prefix
  local header = ngx.req.get_headers()["Authorization"]
  local divider = header:find(' ')
  user_access_token = header:sub(divider + 1)

  if verify_res['sub'] ~= nil then
    unique_name = verify_res['sub']
  end

  if verify_res['preferred_username'] then
    common_name = verify_res['preferred_username']
  elseif verify_res['name'] then
    common_name = verify_res['name']
  end

  if verify_res['email'] then
    email = verify_res['email']
  end
  
  if verify_res['company'] ~= nil then
    ngx.req.set_uri_args({company = verify_res['company']})
  end

else
  ngx.status = 401
  ngx.say("No Authorization header is provided with the request.")
  ngx.exit(ngx.HTTP_UNAUTHORIZED)
end

if user_access_token ~= '' then
  ngx.req.set_header("X-USER-ACCESS-TOKEN", user_access_token)
end

if unique_name ~= '' then
  ngx.req.set_header("X-USER-UNIQUE-NAME", unique_name)
end

if ngx.req.get_headers()["CUSTOM-COMMON-NAME"] then
  ngx.req.set_header("X-USER-COMMON-NAME", ngx.req.get_headers()["CUSTOM-COMMON-NAME"])
elseif common_name ~= '' then
  ngx.req.set_header("X-USER-COMMON-NAME", common_name)
end

if email ~= '' then
  ngx.req.set_header("X-USER-EMAIL", email)
end

-- removing the Authorization header FROM REQUEST to prevent upstream services from using it (e.g. PostgresT's built-in JWT permissioning)
ngx.req.clear_header("Authorization")
