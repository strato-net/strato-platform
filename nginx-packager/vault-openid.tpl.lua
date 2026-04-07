local openidc = require("resty.openidc")

local verify_opts = {
  discovery = "<OAUTH_DISCOVERY_URL_PLACEHOLDER>",
  ssl_verify = "<IS_SSL_PLACEHOLDER_YES_NO>",
  accept_none_alg = false,
  accept_unsupported_alg = false
}

local function nonempty(v)
  return v ~= nil and v ~= ''
end

local function log_vault_auth(stage, extra)
  local details = extra or ""
  ngx.log(ngx.WARN, "[VAULT_AUTH_DEBUG] stage=", stage, " uri=", ngx.var.request_uri, " ", details)
end

local headers = ngx.req.get_headers()
local unique_name = headers["X-USER-UNIQUE-NAME"]
local identity_provider_id = headers["X-IDENTITY-PROVIDER-ID"]
local authz = headers["Authorization"]
local user_access_token = headers["X-USER-ACCESS-TOKEN"]

log_vault_auth(
  "request_start",
  "has_authz=" .. tostring(nonempty(authz)) ..
  " has_x_user_access_token=" .. tostring(nonempty(user_access_token)) ..
  " has_unique_name_hdr=" .. tostring(nonempty(unique_name)) ..
  " has_identity_provider_hdr=" .. tostring(nonempty(identity_provider_id))
)

-- Prefer explicit Authorization header; otherwise accept X-USER-ACCESS-TOKEN.
if not nonempty(authz) and nonempty(user_access_token) then
  if user_access_token:match("^Bearer ") then
    authz = user_access_token
  else
    authz = "Bearer " .. user_access_token
  end
  ngx.req.set_header("Authorization", authz)
end

if nonempty(authz) then
  local verify_res, verify_err = openidc.bearer_jwt_verify(verify_opts)
  if verify_err or not verify_res then
    log_vault_auth("jwt_verify_failed", "error=" .. tostring(verify_err))
    ngx.status = 401
    ngx.say("Authorization header is provided but the bearer token is invalid or expired: " .. (verify_err or "unknown error"))
    ngx.exit(ngx.HTTP_UNAUTHORIZED)
    return
  end
  log_vault_auth("jwt_verified")
  unique_name = verify_res["sub"] or verify_res["preferred_username"] or unique_name
  identity_provider_id = verify_res["iss"] or identity_provider_id
end

-- Keep internal STRATO bootstrap calls working when no token/session exists.
if not nonempty(unique_name) then
  unique_name = "strato-node"
end
if not nonempty(identity_provider_id) then
  identity_provider_id = "local-auth-internal"
end

ngx.req.set_header("X-USER-UNIQUE-NAME", unique_name)
ngx.req.set_header("X-IDENTITY-PROVIDER-ID", identity_provider_id)
ngx.req.clear_header("Authorization")
ngx.req.clear_header("X-USER-ACCESS-TOKEN")

log_vault_auth(
  "headers_forwarded",
  "unique_name=" .. tostring(unique_name) ..
  " identity_provider_id=" .. tostring(identity_provider_id)
)
