local opts = {
  -- OAuth2 callback path
  redirect_uri_path = "/oauth2/callback",

  -- Keycloak discovery endpoint for Mercata realm
  discovery = os.getenv("OAUTH_DISCOVERY_URL") or "https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration",

  -- OAuth2 client credentials
  client_id = os.getenv("OAUTH_CLIENT_ID") or "localhost",
  client_secret = os.getenv("OAUTH_CLIENT_SECRET") or "e4c811c5-d7f1-4e7a-a1fc-8480195e1f01",

  -- SSL verification
  ssl_verify = "no",

  -- Session settings
  refresh_session_interval = 900,
  iat_slack = 600,

  -- Redirect after logout
  logout_path = "/logout",
  redirect_after_logout_uri = "/",

  -- Use PKCE for additional security
  use_pkce = true,

  -- Scope
  scope = "openid email profile",

  -- Keepalive
  keepalive = "yes",

  -- Token endpoint authentication method
  token_endpoint_auth_method = "client_secret_post",

  -- Renew access token on expiry
  renew_access_token_on_expiry = true,
  access_token_expires_in = 3600,
  access_token_expires_leeway = 0,

  -- Session contents to reduce size
  session_contents = {
    id_token = true,
    access_token = true,
    user = true
  }
}

-- Authenticate using OpenID Connect
local res, err = require("resty.openidc").authenticate(opts)

if err then
  ngx.status = 500
  ngx.say("Authentication error: " .. err)
  ngx.exit(ngx.HTTP_INTERNAL_SERVER_ERROR)
end

-- At this point res is a Lua table with:
--   id_token    : claims from the id_token
--   access_token: the access token
--   user        : claims from the user info endpoint

-- Set the X-USER-ACCESS-TOKEN header for the backend API
-- This maintains compatibility with the existing token-based auth
if res.access_token then
  ngx.req.set_header("X-USER-ACCESS-TOKEN", res.access_token)
end

-- Set additional user info headers
if res.id_token and res.id_token.sub then
  ngx.req.set_header("X-USER", res.id_token.sub)
end

if res.id_token and res.id_token.email then
  ngx.req.set_header("X-USER-EMAIL", res.id_token.email)
end

if res.id_token and res.id_token.preferred_username then
  ngx.req.set_header("X-USER-NAME", res.id_token.preferred_username)
end
