local openidc = require("resty.openidc")
local r_jwt = require("resty.jwt")
local cjson_s = require("cjson.safe")

local function isEmpty(s)
  return s == nil or s == ''
end

-- Which property of access token payload to use as STRATO account name
local username_property = "<INITIAL_OAUTH_JWT_USERNAME_PROPERTY_PLACEHOLDER>"

local node_host_with_protocol = string.format("<REDIRECT_URI_SCHEME_PLACEHOLDER_HTTP_HTTPS>://%s/", ngx.var.http_host)

local USER_ID = ''

if ngx.req.get_headers()["Authorization"] then
  
  local auth_header = ngx.req.get_headers()["Authorization"]
  
  -- TODO: MOVE TO CONFIG (if config empty - validate INITIAL_ vars and create config)
  local identity_providers = {
    ["<INITIAL_OAUTH_ISSUER_PLACEHOLDER>"] = {DISCOVERY_URL = "<INITIAL_OAUTH_DISCOVERY_URL_PLACEHOLDER>", USER_ID_CLAIM = "<INITIAL_OAUTH_JWT_USERNAME_PROPERTY_PLACEHOLDER>"},
    ["https://keycloak.blockapps.net/auth/realms/public"] = {DISCOVERY_URL = "https://keycloak.blockapps.net/auth/realms/public/.well-known/openid-configuration", USER_ID_CLAIM = "sub"},
  }
  
--   -- TODO: get ISSUER from Bearer
--   local header = auth_header
--   local divider = header:find(' ')
--   if divider == 0 or string.lower(header:sub(0, divider - 1)) ~= string.lower("Bearer") then
--     err = "no Bearer authorization header value found"
--     ngx.log(ngx.STDERR, err)
--     return nil, err
--   end
--    
--   local access_token = header:sub(divider + 1)
--   if access_token == nil then
--     err = "no Bearer access token value found"
--     ngx.log(ngx.STDERR, err)
--     return nil, err
--   end
-- 
--   local enc_hdr, enc_payload, enc_sign = string.match(auth_header, '^(.+)%.(.+)%.(.*)$')
--   local payload = cjson_s.decode(openidc.openidc_base64_url_decode(enc_payload))
--   local ISSUER = payload['iss']
  
-- --   ngx.log(payload)
-- --   ngx.say(payload)
-- --   ngx.exit(ngx.HTTP_FORBIDDEN)
--   local jwt = require "resty.jwt"
--   local jwt_obj = jwt:load_jwt(access_token)
--   local cjson = require "cjson"
--   ngx.say(cjson.encode(jwt_obj))
--   ngx.exit(ngx.HTTP_FORBIDDEN)
  
  
--   if enc_payload then
--     ngx.say('before jwt')
--     local jwt = openidc.openidc_load_jwt_none_alg(enc_hdr, enc_payload)
--     ngx.say(jwt)
--     if jwt then
--       ngx.say(jwt)
--       ngx.exit(ngx.HTTP_FORBIDDEN)
--     end
--   end
  
  
  
  local ISSUER = 'https://keycloak.blockapps.net/auth/realms/strato-devel'
  
  local PROVIDER_DATA = identity_providers[ISSUER]


  local verify_opts = {
    discovery = PROVIDER_DATA['DISCOVERY_URL'],
    ssl_verify = "<IS_SSL_PLACEHOLDER_YES_NO>",
    accept_none_alg = false,
    accept_unsupported_alg = false
  }

  local verify_res, verify_err = openidc.bearer_jwt_verify(verify_opts)

  if verify_err or not verify_res then
    ngx.status = 403
    ngx.say("Authorization header is provided but the bearer token is invalid or expired. Error: " .. (verify_err or 'unknown error'))
    ngx.exit(ngx.HTTP_FORBIDDEN)
  end

  if not isEmpty(verify_res[PROVIDER_DATA['USER_ID_CLAIM']]) then
    USER_ID = verify_res[PROVIDER_DATA['USER_ID_CLAIM']]
  else 
    ngx.status = 500
    user_err_msg = 'Could not authenticate the request. Unexpected format of bearer token for that issuer.'
    ngx.log(ngx.STDERR, user_err_msg .. ' Error details: Failed to find claims \''..PROVIDER_DATA['USER_ID_CLAIM']..'\' in payload of id_token obtained with openidc.authenticate(). Possible reason: OAUTH_SCOPE does not have the required scope for \''..username_property..'\' claim (current scope value: \''..authenticate_opts.scope..'\')')
    ngx.say(user_err_msg..' Please contact STRATO Vault administrator.')
    ngx.exit(ngx.HTTP_INTERNAL_SERVER_ERROR)
  end

else
  ngx.status = 401
  ngx.say("No Authorization header is provided with the request.")
  ngx.exit(ngx.HTTP_UNAUTHORIZED)
end

-- set request headers to forward to APIs
ngx.req.set_header("X-USER-UNIQUE-NAME", USER_ID)
ngx.req.set_header("X-IDENTITY-PROVIDER-ID", ISSUER)
-- removing the Authorization header FROM REQUEST to prevent Postgrest's built-in JWT permissioning to trigger
ngx.req.clear_header("Authorization")
