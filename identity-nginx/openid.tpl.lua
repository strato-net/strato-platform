-- for openid reference see https://github.com/zmartzone/lua-resty-openidc


--TODO: update steps:

-- This Lua script supports two request types:
-- 1. access_token provided directly in Authorization header (OAuth2 authorization flow happens on the third-party application side) -
--    the token is being verified and we either authorize the request or exit with 403
-- 2. Nginx session-based OAuth2 (for SMD and API calls from browser; uses STRATO client id and secret):
--    if no session provided in request OR session is expired OR access token in session is expired on invalid:
--      - if UI call (SMD, i.e. "/dashboard/..") - redirect to OAuth2 provider sign-in page, then redirect back to the requested page (without hash part of url);
--      - if API call - return 401 Unauthorized with WWW-Authenticate header
--    if valid session is in request and has valid access token - request is authorized
--
-- Note Access token has a "slack" time of 120 sec (default) after access token or session is expired (see for `iat_slack` param in opts)


local openidc = require("resty.openidc")
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

local id_provider = ''
local unique_name = ''
local common_name = ''
local email = ''
local user_access_token = ''
local verify_res = ''
local verify_err = ''

-- If it is a direct call to APIs (with access_token provided as Bearer token in Authorization header)
if ngx.req.get_headers()["Authorization"] then
  local header = ngx.req.get_headers()["Authorization"]
  local identity_providers = config["identity_providers_keyed"]
  id_provider = get_access_token_issuer_unverified(header)
  local provider_data = identity_providers[id_provider]

  if not provider_data then
    ngx.status = 401
    ngx.say("Authorization error: Unsupported access token issuer (unknown identity provider)")
    ngx.exit(ngx.HTTP_UNAUTHORIZED)
  end

  local verify_opts = {
    discovery = provider_data['DISCOVERY_URL'],
    ssl_verify = "<IS_SSL_PLACEHOLDER_YES_NO>",
    accept_none_alg = false,
    accept_unsupported_alg = false
  }

  verify_res, verify_err = openidc.bearer_jwt_verify(verify_opts)

  if verify_err or not verify_res then
    ngx.status = 401
    ngx.say("Authorization header is provided but the bearer token is invalid or expired: " .. (verify_err or 'unknown error'))
    ngx.exit(ngx.HTTP_UNAUTHORIZED)
  end

  -- Token from Authorization header is verified at this point - can blindly get raw token from header by dropping "Bearer " prefix
  local divider = header:find(' ')
  user_access_token = header:sub(divider + 1)

  if verify_res['iss'] ~= nil then
    id_provider = verify_res['iss']
  end

  if verify_res['sub'] ~= nil then
    unique_name = verify_res['sub']
  end

  if verify_res['preferred_username'] then
    common_name = verify_res['preferred_username']
  elseif verify_res['name'] then
    common_name = verify_res['name']
  end

  if verify_res['email'] then
    email = verify_res['email']
  end
  
  if verify_res['company'] ~= nil then
    ngx.req.set_uri_args({company = verify_res['company']})
  end

else
  ngx.status = 401
  ngx.say("No Authorization header is provided with the request.")
  ngx.exit(ngx.HTTP_UNAUTHORIZED)
end

if user_access_token ~= '' then
  ngx.req.set_header("X-USER-ACCESS-TOKEN", user_access_token)
end

if id_provider ~= '' then
  ngx.req.set_header("X-IDENTITY-PROVIDER-ID", id_provider)
end

if unique_name ~= '' then
  ngx.req.set_header("X-USER-UNIQUE-NAME", unique_name)
end

if ngx.req.get_headers()["CUSTOM-COMMON-NAME"] then
  ngx.req.set_header("X-USER-COMMON-NAME", ngx.req.get_headers()["CUSTOM-COMMON-NAME"])
elseif common_name ~= '' then
  ngx.req.set_header("X-USER-COMMON-NAME", common_name)
end

if email ~= '' then
  ngx.req.set_header("X-USER-EMAIL", email)
end

-- removing the Authorization header FROM REQUEST to prevent upstream services from using it (e.g. PostgresT's built-in JWT permissioning)
ngx.req.clear_header("Authorization")
