local lyaml = require "lyaml"
local cjson_s = require("cjson.safe")
local httprequest = require "http.request"

local function isEmpty(s)
    return s == nil or s == ''
  end

local f, readerr = io.open('/tmp/idconf.yaml', "rb")

if readerr or f == nil then
  ngx.log(ngx.STDERR, "Server misconfiguration, error reading the config file. Error: " .. (err or 'unknown error'))
  error('Could not load the idconf.yaml file.')
end

local content = f:read("*all")
f:close()

local idconf, yamlerr = lyaml.load(content)

if yamlerr or idconf == nil then
    ngx.log(ngx.STDERR,  "Server misconfiguration, error parsing the configuration yaml. Error: " .. (err2 or 'unknown error'))
    error('Could not parse the idconf.yaml file.')
end

local config = {identity_providers_keyed = {}}

for _, realm in ipairs(idconf) do
    if isEmpty(realm["discoveryUrl"]) then
        ngx.log(ngx.STDERR, "Server misconfiguration, error in reading idconf.yaml. Error: each list element in configuration yaml is expected to have a discoveryUrl property.")
        error('Server misconfiguration, error in reading idconf.yaml. Error: each list element in yaml is expected to have discoveryUrl property.')
    end
    local discoveryrequest = httprequest.new_from_uri(realm["discoveryUrl"])
    local headers, stream = assert(discoveryrequest:go())
    local discoverycontent = assert(stream:get_body_as_string())
    
    if headers:get(":status") ~= "200" then
        local errmsg = "Could not retrieve from discovery url" .. realm["discoveryUrl"]..". Got http response code " .. headers:get(":status") .. "with body " .. discoverycontent
        ngx.log(ngx.STDERR, errmsg)
        error(errmsg)
    end
    
    discoveryjson, jsonerr = cjson_s.decode(discoverycontent)
    if jsonerr, discoveryjson == nil then
        ngx.log(ngx.STDERR, "Could not parse response from provided discovery url: " .. realm["discoveryUrl"])
        error('Could not parse the response from discovery url')
    end

    if isEmpty(discoveryjson["issuer"]) then
        error('Response from discovery url is not of expected format. No issuer found.')
    end

    config["identity_providers_keyed"][discoveryjson["issuer"]] = { DISCOVERY_URL = realm["discoveryUrl"] }
end

return config