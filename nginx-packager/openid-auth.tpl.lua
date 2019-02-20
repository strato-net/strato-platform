-- TODO: refactor with shared lua util file for common stuff across the lua scripts

local access_token_cookie_name = "strato_access_token"
local username_cookie_name = "strato_user_name"
local username_property = "<OAUTH_JWT_USERNAME_PROPERTY>"

-- configruation for openid connect
local opts = {
    -- see https://github.com/zmartzone/lua-resty-openidc for reference
    -- TODO: DEPRECATED: "using deprecated option `opts.redirect_uri_path`; switch to using an absolute URI and `opts.redirect_uri"
    redirect_uri_path             = "/auth/openidc/return",
    discovery                     = "<OAUTH_DISCOVERY_URL>",
    client_id                     = "<CLIENT_ID_PLACEHOLDER>",
    client_secret                 = "<CLIENT_SECRET_PLACEHOLDER>",
    scope                         = "openid email",
    token_endpoint_auth_method    = "client_secret_post",
    ssl_verify                    = "<IS_SSL_PLACEHOLDER_YES_NO>",
    redirect_uri_scheme           = "<REDIRECT_URI_SCHEME_PLACEHOLDER_HTTP_HTTPS>",
    -- 'access_token' is required for refresh token, 'user' is for providers sending 'email' in user object instead openid
    -- keeping commented to have everything stored in session
    -- session_contents           = {id_token=true, user=true, access_token=true},
    renew_access_token_on_expiry  = true,
    access_token_expires_in       = 3600,
    logout_path                   = "/auth/openidc/logout",
    -- TODO: handle the logout properly, unset the cookie for client
    --  redirect_after_logout_uri  = "https://login.microsoftonline.com/common/oauth2/logout", -- ?post_logout_redirect_uri=http://localhost/"
    --  redirect_after_logout_with_id_token_hint = true,
}

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
  -- TODO: make sure appid is in the id_token when the token is obtained with oauth client credential grant flow (machine way to authenticate)
  unique_name=res.id_token.appid
end
ngx.header['Set-Cookie'] = username_cookie_name .. '=' .. unique_name .. '; path=/'


local current_access_token = ngx.var["cookie_" .. access_token_cookie_name]
if current_access_token ~= res.access_token then
  -- TODO: set "expires" for ${cookie_name} cookie with 'res.id_token.exp' value (need to transform timestamp into proper format with lua)
  ngx.header['Set-Cookie'] = access_token_cookie_name .. '=' .. res.access_token .. '; path=/;'
end
