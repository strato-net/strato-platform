-- Guards the public /rpc endpoint against the expensive VM methods (the
-- strato_* namespace: strato_simulateV1 and the strato_trace* family), which
-- re-execute transactions in a sandbox and can bog down the VM. These are only
-- needed via the authenticated-optional bloc simulate endpoint, which reaches
-- the VM by a separate internal path (container-to-container on the RPC port)
-- and never traverses this location.
--
-- Included in the /rpc location only when PUBLIC_STRATO_RPC_ENABLED != true
-- (see docker-run.sh / #TEMPLATE_MARK_STRATO_RPC_GUARD). Read-only methods such
-- as eth_call, eth_getBalance and the cheap debug_traceBlockByHash (attribution
-- frames read from stored results, no re-execution) are left available.

local cjson = require "cjson.safe"

-- Returns true for a method that must not be reachable on the public endpoint.
local function is_blocked(method)
  if type(method) ~= "string" then
    return false
  end
  if method:sub(1, 7) == "strato_" then
    return true
  end
  return false
end

local function reject()
  ngx.status = 403
  ngx.header.content_type = "application/json"
  ngx.say('{"jsonrpc":"2.0","error":{"code":-32601,"message":"method not available on the public RPC endpoint"},"id":null}')
  return ngx.exit(ngx.HTTP_OK)
end

ngx.req.read_body()
local body = ngx.req.get_body_data()
if not body then
  -- Large bodies spill to a temp file; read it so padding can't bypass the guard.
  local path = ngx.req.get_body_file()
  if path then
    local fh = io.open(path, "rb")
    if fh then
      body = fh:read("*a")
      fh:close()
    end
  end
end

-- If we still can't read/parse the body, let the upstream return a proper
-- JSON-RPC parse error rather than guessing.
if not body then
  return
end

local parsed = cjson.decode(body)
if parsed == nil then
  return
end

if parsed[1] ~= nil then
  -- Batch request: reject if any sub-call targets a blocked method.
  for _, call in ipairs(parsed) do
    if type(call) == "table" and is_blocked(call.method) then
      return reject()
    end
  end
else
  if is_blocked(parsed.method) then
    return reject()
  end
end
