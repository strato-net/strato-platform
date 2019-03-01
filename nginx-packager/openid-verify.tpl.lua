-- TODO: refactor with shared lua util file for common stuff across the lua scripts

--'aud' should not necessarily contain the URLs according to openid standard. Could be the unique client ids instead. Skipping check.
--local expected_audience = "<NODE_HOST_PROTOCOL>://<NODE_HOST>"

local access_token_cookie_name = "strato_access_token"
local username_property = "<OAUTH_JWT_USERNAME_PROPERTY>"

local opts = {
  -- see https://github.com/zmartzone/lua-resty-openidc for reference
  discovery                     = "<OAUTH_DISCOVERY_URL>",
  ssl_verify                    = "<IS_SSL_PLACEHOLDER_YES_NO>",
  accept_none_alg               = false,
  accept_unsupported_alg        = false
}

if ngx.var['cookie_'..access_token_cookie_name] and not ngx.req.get_headers()["Authorization"] then
  ngx.req.set_header("Authorization", "Bearer " .. ngx.var['cookie_'..access_token_cookie_name])
end

-- call bearer_jwt_verify for OAuth 2.0 JWT validation
local res, err = require("resty.openidc").bearer_jwt_verify(opts)

if err or not res then
    ngx.status = 403
    ngx.say(err and err or "no access_token provided")
    ngx.exit(ngx.HTTP_FORBIDDEN)
end

--if res.aud ~= expected_audience then
--  ngx.status = 403
--  ngx.say("audience in token (" .. res.aud .. ") does not match with expected audience (" .. expected_audience .. ")")
--  ngx.exit(ngx.HTTP_FORBIDDEN)
--end

--if res.scope ~= "edit" then
--  ngx.exit(ngx.HTTP_FORBIDDEN)
--end

--if res.client_id ~= "ro_client" then
--  ngx.exit(ngx.HTTP_FORBIDDEN)
--end

local function isEmpty(s) 
  return s == nil or s == ''
end

local unique_name = '' 
if not isEmpty(res[username_property]) then
  unique_name=res[username_property]
else 
  unique_name=res.appid 
end 

local user_id = res.sub

-- set request header to forward to APIs
ngx.req.set_header("X-USER-UNIQUE-NAME", unique_name)
ngx.req.set_header("X-USER-ID", user_id)
-- Clearing Authorization header to prevent Postgrest's built-in JWT permissioning to trigger
ngx.req.clear_header("Authorization")
