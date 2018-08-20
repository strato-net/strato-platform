local expected_audience = "<NODE_HOST_PROTOCOL>://<NODE_HOST>"

local opts = {
  -- see https://github.com/zmartzone/lua-resty-openidc for reference
  discovery                     = "<OAUTH_JWT_VALIDATION_DISCOVERY_URL>",
  ssl_verify                    = "<IS_SSL_PLACEHOLDER_YES_NO>",
  accept_none_alg               = false,
  accept_unsupported_alg        = false
}

-- call bearer_jwt_verify for OAuth 2.0 JWT validation
local res, err = require("resty.openidc").bearer_jwt_verify(opts)

if err or not res then
    ngx.status = 403
    ngx.say(err and err or "no access_token provided")
    ngx.exit(ngx.HTTP_FORBIDDEN)
end

if res.aud ~= expected_audience then
  ngx.status = 403
  ngx.say("audience in token (" .. res.aud .. ") does not match with expected audience (" .. expected_audience .. ")")
  ngx.exit(ngx.HTTP_FORBIDDEN)
end

--if res.scope ~= "edit" then
--  ngx.exit(ngx.HTTP_FORBIDDEN)
--end

--if res.client_id ~= "ro_client" then
--  ngx.exit(ngx.HTTP_FORBIDDEN)
--end

-- some oauth providers return email under `id_token` object, some - under `user`
local unique_name = res.email -- OR use res.unique_name instead? Currently it's res.email to comply with strato oauth
local user_id = res.sub

-- set request header to forward to APIs
ngx.req.set_header("X-USER-UNIQUE-NAME", unique_name)
ngx.req.set_header("X-USER-ID", user_id)