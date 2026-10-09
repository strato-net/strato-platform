// Request tracing for app-backend: one server span per request continuing
// the traceparent nginx sends (or the load balancer's X-Amzn-Trace-Id), and
// a traceparent on every call this service makes to the node, so the app,
// the edge and strato-api show up as one trace. Spans ship as OTLP/JSON to
// OTEL_EXPORTER_OTLP_ENDPOINT (the collector sidecar); unset, nothing is
// recorded and requests pay one header lookup.
import { AsyncLocalStorage } from "async_hooks";
import { randomBytes } from "crypto";
import type { NextFunction, Request, Response } from "express";

export interface TraceContext {
  traceId: string;
  spanId: string;
}

export const traceStore = new AsyncLocalStorage<TraceContext>();

const endpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "").replace(/\/+$/, "");
const service = process.env.OTEL_SERVICE_NAME || "app-backend";
export const tracingEnabled = endpoint !== "";

const HEX32 = /^[0-9a-f]{32}$/;
const HEX16 = /^[0-9a-f]{16}$/;

export const parseTraceparent = (h: unknown): { traceId: string; parentId: string } | null => {
  if (typeof h !== "string") return null;
  const m = h.trim().match(/^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/i);
  if (!m) return null;
  const traceId = m[2].toLowerCase();
  if (traceId === "0".repeat(32)) return null;
  return { traceId, parentId: m[3].toLowerCase() };
};

export const parseAmznTraceId = (h: unknown): { traceId: string; parentId?: string } | null => {
  if (typeof h !== "string") return null;
  const root = h.match(/Root=1-([0-9a-f]{8})-([0-9a-f]{24})/i);
  if (!root) return null;
  const parent = h.match(/Parent=([0-9a-f]{16})/i);
  return { traceId: (root[1] + root[2]).toLowerCase(), parentId: parent ? parent[1].toLowerCase() : undefined };
};

const hex = (n: number) => randomBytes(n).toString("hex");

interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: { key: string; value: { stringValue?: string; intValue?: string } }[];
  status: { code: number; message?: string };
}

const queue: Span[] = [];
let lastExportError = 0;

const flush = async () => {
  if (queue.length === 0) return;
  const spans = queue.splice(0, 512);
  const body = JSON.stringify({
    resourceSpans: [
      {
        resource: { attributes: [{ key: "service.name", value: { stringValue: service } }] },
        scopeSpans: [{ scope: { name: "strato-app-backend" }, spans }],
      },
    ],
  });
  try {
    const res = await fetch(`${endpoint}/v1/traces`, { method: "POST", headers: { "content-type": "application/json" }, body });
    if (!res.ok) throw new Error(`collector returned HTTP ${res.status}`);
  } catch (error) {
    const now = Date.now();
    if (now - lastExportError > 60000) {
      lastExportError = now;
      console.warn(`[Tracing] export failed, dropped ${spans.length} span(s): ${error instanceof Error ? error.message : String(error)}`);
    }
  }
};

if (tracingEnabled) {
  setInterval(() => void flush(), 2000).unref();
  console.log(`[Tracing] exporting spans for ${service} to ${endpoint}`);
}

const nanos = (ms: number) => `${Math.round(ms * 1e6)}`;

/** The header to put on outgoing requests made while handling a request. */
export const traceparentHeader = (): string | undefined => {
  const c = traceStore.getStore();
  return c ? `00-${c.traceId}-${c.spanId}-01` : undefined;
};

export const tracingMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  if (!tracingEnabled) {
    next();
    return;
  }
  const incoming = parseTraceparent(req.headers.traceparent) ?? parseAmznTraceId(req.headers["x-amzn-trace-id"]);
  const traceId = incoming?.traceId && HEX32.test(incoming.traceId) ? incoming.traceId : hex(16);
  const parentSpanId = incoming?.parentId && HEX16.test(incoming.parentId) ? incoming.parentId : undefined;
  const ctx: TraceContext = { traceId, spanId: hex(8) };
  const started = Date.now();
  res.setHeader("x-trace-id", traceId);
  res.on("finish", () => {
    if (queue.length > 5000) return; // never let tracing back up the service
    const status = res.statusCode;
    queue.push({
      traceId: ctx.traceId,
      spanId: ctx.spanId,
      parentSpanId,
      name: `${req.method} ${req.route?.path ? req.baseUrl + req.route.path : req.path}`,
      kind: 2,
      startTimeUnixNano: nanos(started),
      endTimeUnixNano: nanos(Date.now()),
      attributes: [
        { key: "http.method", value: { stringValue: req.method } },
        { key: "http.target", value: { stringValue: req.originalUrl } },
        { key: "http.status_code", value: { intValue: String(status) } },
        { key: "net.peer.ip", value: { stringValue: req.ip || "" } },
      ],
      status: status >= 500 ? { code: 2, message: `HTTP ${status}` } : { code: 0 },
    });
  });
  traceStore.run(ctx, next);
};
