-- Request tracing for the STRATO edge: one server span per request,
-- continuing the trace the load balancer started (X-Amzn-Trace-Id) or a
-- client sent (traceparent), and handing a W3C traceparent to the upstream
-- so strato-api, ethereum-jsonrpc and app-backend continue it.
--
-- Spans are queued in a shared dict and shipped every two seconds as
-- OTLP/JSON to $OTEL_EXPORTER_OTLP_ENDPOINT (the collector on localhost).
-- Unset, start() only passes an incoming traceparent through and nothing
-- is recorded.
--
-- Hooks (nginx.tpl.conf):
--   env OTEL_EXPORTER_OTLP_ENDPOINT; env OTEL_SERVICE_NAME;
--   lua_shared_dict otel_spans 4M;
--   init_worker_by_lua_block { require("tracing").init_worker() }
--   set_by_lua_block $otel_traceparent { return require("tracing").start() }
--   proxy_set_header traceparent $otel_traceparent;
--   log_by_lua_block { require("tracing").finish() }

local _M = {}

local endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
local service = os.getenv("OTEL_SERVICE_NAME") or "nginx"
local enabled = endpoint ~= nil and endpoint ~= ""
if enabled then endpoint = endpoint:gsub("/+$", "") end

local QUEUE = "otel_spans"
local MAX_BATCH = 200

local function is_hex(s, n)
  return type(s) == "string" and #s == n and s:match("^%x+$") ~= nil
end

-- traceparent: 00-<32 hex>-<16 hex>-<2 hex>
local function parse_traceparent(h)
  if not h then return nil end
  local ver, tid, sid = h:match("^%s*(%x%x)%-(%x+)%-(%x+)%-%x%x%s*$")
  if ver and is_hex(tid, 32) and is_hex(sid, 16) and tid ~= string.rep("0", 32) then
    return tid:lower(), sid:lower()
  end
  return nil
end

-- X-Amzn-Trace-Id: Root=1-<8 hex>-<24 hex>;Parent=<16 hex>;Sampled=1
local function parse_amzn(h)
  if not h then return nil end
  local epoch, rest = h:match("Root=1%-(%x+)%-(%x+)")
  if not (epoch and is_hex(epoch, 8) and is_hex(rest, 24)) then return nil end
  local parent = h:match("Parent=(%x+)")
  if not is_hex(parent or "", 16) then parent = nil end
  return (epoch .. rest):lower(), parent and parent:lower() or nil
end

-- set_by_lua (rewrite phase): decide the ids, remember them for finish(),
-- return the traceparent for the upstream.
function _M.start()
  local incoming = ngx.var.http_traceparent
  local tid, parent = parse_traceparent(incoming)
  if not tid then tid, parent = parse_amzn(ngx.var.http_x_amzn_trace_id) end
  if not enabled then
    return incoming or ""
  end
  local request_id = ngx.var.request_id or ""
  if not tid then tid = request_id end
  if not is_hex(tid, 32) then return incoming or "" end
  local sid = request_id:sub(1, 16)
  if not is_hex(sid, 16) then return incoming or "" end
  ngx.ctx.otel = { trace_id = tid, span_id = sid, parent_id = parent }
  return "00-" .. tid .. "-" .. sid .. "-01"
end

local function attr(k, v)
  if type(v) == "number" then
    return { key = k, value = { intValue = tostring(math.floor(v)) } }
  end
  return { key = k, value = { stringValue = tostring(v) } }
end

-- log_by_lua: the request is done, record its span.
function _M.finish()
  if not enabled then return end
  local c = ngx.ctx.otel
  if not c then return end
  local start = ngx.req.start_time()
  local finish = ngx.now()
  local status = tonumber(ngx.var.status) or 0
  local span = {
    traceId = c.trace_id,
    spanId = c.span_id,
    parentSpanId = c.parent_id,
    name = ngx.var.request_method .. " " .. (ngx.var.uri or "/"),
    kind = 2,
    startTimeUnixNano = string.format("%.0f", start * 1e9),
    endTimeUnixNano = string.format("%.0f", finish * 1e9),
    attributes = {
      attr("http.method", ngx.var.request_method),
      attr("http.target", ngx.var.request_uri or ""),
      attr("http.status_code", status),
      attr("http.host", ngx.var.host or ""),
      attr("net.peer.ip", ngx.var.remote_addr or ""),
      attr("http.upstream", ngx.var.upstream_addr or ""),
    },
    status = status >= 500 and { code = 2, message = "HTTP " .. status } or { code = 0 },
  }
  local ok, encoded = pcall(require("cjson").encode, span)
  if not ok then return end
  local dict = ngx.shared[QUEUE]
  if not dict then return end
  local len = dict:llen(QUEUE) or 0
  if len > 5000 then return end -- never let tracing back up nginx
  dict:rpush(QUEUE, encoded)
end

local function flush(premature)
  if premature or not enabled then return end
  local dict = ngx.shared[QUEUE]
  if not dict then return end
  local spans = {}
  for _ = 1, MAX_BATCH do
    local v = dict:lpop(QUEUE)
    if not v then break end
    spans[#spans + 1] = v
  end
  if #spans == 0 then return end
  local body = '{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"'
    .. service .. '"}}]},"scopeSpans":[{"scope":{"name":"strato-nginx"},"spans":[' .. table.concat(spans, ",") .. "]}]}]}"
  local httpc = require("resty.http").new()
  httpc:set_timeout(2000)
  local res, err = httpc:request_uri(endpoint .. "/v1/traces", {
    method = "POST",
    body = body,
    headers = { ["Content-Type"] = "application/json" },
  })
  if not res then
    ngx.log(ngx.WARN, "tracing: export failed, dropped ", #spans, " span(s): ", err)
  elseif res.status < 200 or res.status >= 300 then
    ngx.log(ngx.WARN, "tracing: collector returned ", res.status, ", dropped ", #spans, " span(s)")
  end
end

function _M.init_worker()
  if not enabled then return end
  local ok, err = ngx.timer.every(2, flush)
  if not ok then ngx.log(ngx.ERR, "tracing: cannot start export timer: ", err) end
end

return _M
