-- configruation for AAD
local opts = {
  redirect_uri_path          = "/auth/openidc/return",
  discovery                  = "https://login.microsoftonline.com/<TENANT_ID_PLACEHOLDER>/v2.0/.well-known/openid-configuration",
  client_id                  = "<CLIENT_ID_PLACEHOLDER>",
  client_secret              = "<CLIENT_SECRET_PLACEHOLDER>",
  scope                      = "openid",
  token_endpoint_auth_method = "client_secret_post",
  ssl_verify                 = "<IS_SSL_PLACEHOLDER_YES_NO>",
  redirect_uri_scheme        = "<REDIRECT_URI_SCHEME_PLACEHOLDER_HTTP_HTTPS>",
  session_contents           = {id_token=true},
  logout_path                = "/auth/openidc/logout",
  redirect_after_logout_uri  = "https://login.microsoftonline.com/common/oauth2/logout", -- ?post_logout_redirect_uri=http://localhost/"
  redirect_after_logout_with_id_token_hint = true,
}

-- call opendic for microsoft azure
local res, err = require("resty.openidc").authenticate(opts)

-- set request header to forward to APIs
ngx.req.set_header("x-user", res.id_token.sub)

-- set response header (if needed)
-- ngx.header['MY-HEADER'] = "something"

-- error handling needs to be polished
if err then
  ngx.status = 500
  ngx.say(err)
  ngx.exit(ngx.HTTP_INTERNAL_SERVER_ERROR)
end