-- TODO: refactor with shared lua util file for common stuff across the lua scripts

local access_token_cookie_name = "strato_access_token"
local username_cookie_name = "strato_user_name"
local username_property = "<OAUTH_JWT_USERNAME_PROPERTY>"

-- configruation for openid connect
local opts = {
    -- see https://github.com/zmartzone/lua-resty-openidc for reference
    redirect_uri                  = "/auth/openidc/return",
    discovery                     = "<OAUTH_DISCOVERY_URL>",
    client_id                     = "<CLIENT_ID_PLACEHOLDER>",
    client_secret                 = "<CLIENT_SECRET_PLACEHOLDER>",
    scope                         = "openid email",
    token_endpoint_auth_method    = "client_secret_post",
    ssl_verify                    = "<IS_SSL_PLACEHOLDER_YES_NO>",
    redirect_uri_scheme           = "<REDIRECT_URI_SCHEME_PLACEHOLDER_HTTP_HTTPS>",
    -- 'id_token' to get user data; 'access_token' for access and refresh tokens; 'user' to get additional user data (some providers include 'email' in user object instead of id_token)
    --session_contents              = {id_token=true, access_token=true}, -- comment out to keep everything
    renew_access_token_on_expiry  = true,
    access_token_expires_in       = 3600,
    logout_path                   = "/auth/logout",
    post_logout_redirect_uri      = "<REDIRECT_URI_SCHEME_PLACEHOLDER_HTTP_HTTPS>://"..ngx.var.http_host.."/"
}

-- If it's the logout request - unset custom cookies. All the rest is handled by .authenticate()
if ngx.var.request_uri == opts.logout_path then
  ngx.header['Set-Cookie'] = access_token_cookie_name .. '=""; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
  ngx.header['Set-Cookie'] = username_cookie_name .. '=""; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
end

-- call authenticate for OpenID Connect user authentication
local res, err = require("resty.openidc").authenticate(opts)

-- error handling needs to be polished
if err then
  ngx.status = 500
  ngx.say(err)
  ngx.exit(ngx.HTTP_INTERNAL_SERVER_ERROR)
  ngx.header['Set-Cookie'] = access_token_cookie_name .. '=""; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
  ngx.header['Set-Cookie'] = username_cookie_name .. '=""; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
end

local function isEmpty(s)
  return s == nil or s == ''
end

-- get username from access token and set username cookie (used in SMD UI)
local unique_name = ''
if not isEmpty(res.id_token[username_property]) then
  unique_name=res.id_token[username_property]
else
  unique_name=res.id_token.appid
end
ngx.header['Set-Cookie'] = username_cookie_name .. '=' .. unique_name .. '; path=/'


local current_access_token = ngx.var["cookie_" .. access_token_cookie_name]
if current_access_token ~= res.access_token then
  -- TODO: set "expires" for ${cookie_name} cookie with 'res.id_token.exp' value (need to transform timestamp into proper format with lua)
  ngx.header['Set-Cookie'] = access_token_cookie_name .. '=' .. res.access_token .. '; path=/;'
end
