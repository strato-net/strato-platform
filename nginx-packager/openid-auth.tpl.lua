-- configruation for openid connect
local opts = {
    redirect_uri_path             = "/auth/openidc/return",
    discovery                     = "<OAUTH_OPENID_DISCOVERY_URL>",
    client_id                     = "<CLIENT_ID_PLACEHOLDER>",
    client_secret                 = "<CLIENT_SECRET_PLACEHOLDER>",
    scope                         = "openid email",
    token_endpoint_auth_method    = "client_secret_post",
    ssl_verify                    =  "<IS_SSL_PLACEHOLDER_YES_NO>",
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
end

-- some oauth providers return email under `id_token` object, some - under `user`
local unique_name = res.id_token.email or res.user.email
local user_id = res.id_token.sub

-- set request header to forward to APIs
ngx.req.set_header("X-USER-UNIQUE-NAME", unique_name)
ngx.req.set_header("X-USER-ID", user_id)

-- set response cookie header
ngx.header['Set-Cookie'] = 'strato_user_name=' .. unique_name .. '; path=/'
