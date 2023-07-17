local openidc = require("resty.openidc")
local r_jwt = require("resty.jwt")
local cjson_s = require("cjson.safe")
local unb64 = ngx.decode_base64

local config = require("cfg-loader")


assert(type(config) == "table", "Config should be in the expected format.")

local function get_bearer_access_token_from_header(header)
  local err
  local divider = header:find(' ')
  if divider == 0 or string.lower(header:sub(0, divider - 1)) ~= string.lower("Bearer") then
    err = "no Bearer authorization header value found"
    ngx.log(ngx.ERR, err)
    return nil, err
  end

  local access_token = header:sub(divider + 1)
  if access_token == nil then
    err = "no Bearer access token value found"
    ngx.log(ngx.ERR, err)
    return nil, err
  end

  return access_token, err
end


-- From lua-resty-openidc
local function openidc_base64_url_decode(input)
  local reminder = #input % 4
  if reminder > 0 then
    local padlen = 4 - reminder
    input = input .. string.rep('=', padlen)
  end
  input = input:gsub('%-', '+'):gsub('_', '/')
  return unb64(input)
end


local function get_access_token_issuer_unverified(header)
  local access_token, err1 = get_bearer_access_token_from_header(header)
  if err or not access_token then
    ngx.status = 401
    ngx.say("Wrong Authorization header format. Error: " .. (err or 'unknown error'))
    ngx.exit(ngx.HTTP_UNAUTHORIZED)
    return
  end
  local enc_hdr, enc_payload, enc_sign = string.match(header, '^(.+)%.(.+)%.(.*)$')
  if not enc_hdr or not enc_payload or not enc_sign then
    ngx.status = 401
    ngx.say("Authorization error: Wrong JWT format")
    ngx.exit(ngx.HTTP_UNAUTHORIZED)
    return
  end
  local payload = cjson_s.decode(openidc_base64_url_decode(enc_payload))
  if payload then
    if not payload['iss'] then
      ngx.status = 401
      ngx.say("Authorization error: No 'iss' in JWT payload")
      ngx.exit(ngx.HTTP_UNAUTHORIZED)
      return
    end
    return payload['iss']
  end
  ngx.status = 401
  ngx.say("Authorization error: Wrong access token format.")
  ngx.exit(ngx.HTTP_UNAUTHORIZED)
  return
end


local function isEmpty(s)
  return s == nil or s == ''
end

local node_host_with_protocol = string.format("<REDIRECT_URI_SCHEME_PLACEHOLDER_HTTP_HTTPS>://%s/", ngx.var.http_host)

local USER_ID
local ISSUER

if ngx.req.get_headers()["Authorization"] then
  
  local auth_header = ngx.req.get_headers()["Authorization"]
  local identity_providers = config["identity_providers_keyed"]
  ISSUER = get_access_token_issuer_unverified(auth_header)
  local PROVIDER_DATA = identity_providers[ISSUER]

  if not PROVIDER_DATA then
    ngx.status = 401
    ngx.say("Authorization error: Unsupported access token issuer (unknown identity provider)")
    ngx.exit(ngx.HTTP_UNAUTHORIZED)
  end

  local verify_opts = {
    discovery = PROVIDER_DATA['DISCOVERY_URL'],
    ssl_verify = "<IS_SSL_PLACEHOLDER_YES_NO>",
    accept_none_alg = false,
    accept_unsupported_alg = false
  }

  local verify_res, verify_err = openidc.bearer_jwt_verify(verify_opts)

  if verify_err or not verify_res then
    ngx.status = 401
    ngx.say("Authorization header is provided but the bearer token is invalid or expired. Error: " .. (verify_err or 'unknown error'))
    ngx.exit(ngx.HTTP_UNAUTHORIZED)
  end

  if not isEmpty(verify_res[PROVIDER_DATA['USER_ID_CLAIM']]) then
    USER_ID = verify_res[PROVIDER_DATA['USER_ID_CLAIM']]
  else 
    ngx.status = 500
    user_err_msg = 'Could not authenticate the request. Unexpected format of bearer token for that issuer.'
    ngx.log(ngx.STDERR, user_err_msg .. ' Error details: Failed to find claim \''..PROVIDER_DATA['USER_ID_CLAIM']..'\' in payload of the token.')
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
-- removing the Authorization header FROM REQUEST to prevent downstream services from using it by mistake.
ngx.req.clear_header("Authorization")
