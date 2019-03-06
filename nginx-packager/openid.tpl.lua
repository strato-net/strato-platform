-- for openid reference see https://github.com/zmartzone/lua-resty-openidc 

local openidc = require("resty.openidc")
local username_cookie_name = "strato_user_name"
local username_property = "<OAUTH_JWT_USERNAME_PROPERTY>"

local function isEmpty(s)
  return s == nil or s == ''
end

local unique_name = ''
local user_id = ''

local verify_opts = {
  discovery = "<OAUTH_DISCOVERY_URL>",
  ssl_verify = "<IS_SSL_PLACEHOLDER_YES_NO>",
  accept_none_alg = false,
  accept_unsupported_alg = false
}

local authenticate_opts = {
  redirect_uri = "/auth/openidc/return",
  discovery = "<OAUTH_DISCOVERY_URL>",
  client_id = "<CLIENT_ID_PLACEHOLDER>",
  client_secret = "<CLIENT_SECRET_PLACEHOLDER>",
  scope = "openid email",
  token_endpoint_auth_method = "client_secret_post",
  ssl_verify = "<IS_SSL_PLACEHOLDER_YES_NO>",
  redirect_uri_scheme = "<REDIRECT_URI_SCHEME_PLACEHOLDER_HTTP_HTTPS>",
  -- 'id_token' to get user data; 'access_token' for access and refresh tokens; 'user' to get additional user data (some providers include 'email' in user object instead of id_token)
  --session_contents              = {id_token=true, access_token=true}, -- comment out to keep everything
  renew_access_token_on_expiry = true,
  access_token_expires_in = 3600,
  logout_path = "/auth/logout",
  post_logout_redirect_uri = "<REDIRECT_URI_SCHEME_PLACEHOLDER_HTTP_HTTPS>://" .. ngx.var.http_host .. "/"
}

if not ngx.var['cookie_strato_session'] and ngx.req.get_headers()["Authorization"] then
  local verify_res, verify_err = openidc.bearer_jwt_verify(verify_opts)

  if verify_err or not verify_res then
    ngx.status = 403
    ngx.say(verify_err and verify_err or "no access_token provided")
    ngx.exit(ngx.HTTP_FORBIDDEN)
  end

  if not isEmpty(verify_res[username_property]) then
    unique_name = verify_res[username_property]
  else
    unique_name = verify_res.appid
  end

  user_id = verify_res.sub

else
  -- If it's the logout request - unset custom cookies. All the rest is handled by .authenticate()
  if ngx.var.request_uri == authenticate_opts.logout_path then
    ngx.header['Set-Cookie'] = username_cookie_name .. '=""; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
  end

  local authenticate_res, authenticate_err = openidc.authenticate(authenticate_opts)

  if authenticate_err then
    ngx.status = 500
    ngx.say(authenticate_err)
    ngx.exit(ngx.HTTP_INTERNAL_SERVER_ERROR)
    ngx.header['Set-Cookie'] = username_cookie_name .. '=""; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
  end

  if not isEmpty(authenticate_res.id_token[username_property]) then
    unique_name = authenticate_res.id_token[username_property]
  else
    unique_name = authenticate_res.id_token.appid
  end

  user_id = authenticate_res.id_token.sub

  ngx.header['Set-Cookie'] = username_cookie_name .. '=' .. unique_name .. '; path=/'
end

-- set request header to forward to APIs
ngx.req.set_header("X-USER-UNIQUE-NAME", unique_name)
ngx.req.set_header("X-USER-ID", user_id)
-- removing the Authorization header FROM REQUEST to prevent Postgrest's built-in JWT permissioning to trigger
ngx.req.clear_header("Authorization")
