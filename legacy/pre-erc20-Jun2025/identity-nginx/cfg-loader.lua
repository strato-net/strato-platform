local cjson_s = require("cjson.safe")


local function isEmpty(s)
  return s == nil or s == ''
end


local f, err = io.open('/config/config.json', "rb")

if err or f == nil then
  ngx.log(ngx.STDERR, "Server misconfiguration, error reading the config file. Error: " .. (err or 'unknown error'))
  error('Could not load the config.json file.')
end

local content = f:read("*all")
f:close()

local config, err2 = cjson_s.decode(content)

if err2 or config == nil then
  ngx.log(ngx.STDERR, "Server misconfiguration, error parsing the configuration JSON. Error: " .. (err2 or 'unknown error'))
  error('Could not parse the config.json file.')
end

-- Post-process identity providers
config["identity_providers_keyed"] = {}
for _, idp in ipairs(config["identity_providers"]) do
  if isEmpty(idp["ISSUER"]) or isEmpty(idp["DISCOVERY_URL"]) then
    ngx.log(ngx.STDERR, "Server misconfiguration, error in identity_providers configuration. Error: each identity provider in configuration JSON is expected to have ISSUER and DISCOVERY_URL properties not empty")
    error('Server misconfiguration, error in identity_providers configuration. Error: each identity provider in JSON is expected to have ISSUER and DISCOVERY_URL properties')
  end
  config["identity_providers_keyed"][idp["ISSUER"]] = { DISCOVERY_URL = idp["DISCOVERY_URL"]}
end

return config
