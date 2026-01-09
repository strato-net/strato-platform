import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { GriphookClient } from "./client.js";
import { registerTools } from "./tools.js";
import { registerResources } from "./resources.js";

function buildServer(config: ReturnType<typeof loadConfig>) {
  const instructions = [
    "Griphook MCP server exposes the STRATO web app backend. Authentication uses BlockApps OAuth credentials (BLOCKAPPS_USERNAME, BLOCKAPPS_PASSWORD).",
    `API base: ${config.apiBaseUrl}. Override with STRATO_API_BASE_URL.`,
    "Use strato.api-request for arbitrary endpoints; domain tools (strato.tokens, strato.swap, strato.lending, strato.cdp, strato.bridge, strato.rewards, strato.admin, strato.events, strato.protocol-fees, strato.rpc) provide common workflows.",
    `HTTP transport: ${config.http.enabled ? `POST ${config.http.host}:${config.http.port}${config.http.path}` : "disabled (set GRIPHOOK_HTTP_ENABLED=true)"}.`,
  ].join("\n");

  const server = new McpServer(
    { name: "griphook", version: "0.1.0" },
    { capabilities: { logging: {} }, instructions },
  );

  const client = new GriphookClient(config);

  registerResources(server, config);
  registerTools(server, client, config);

  return server;
}

async function startStdioServer(config: ReturnType<typeof loadConfig>) {
  const server = buildServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return async () => {
    await server.close();
  };
}

async function startHttpServer(config: ReturnType<typeof loadConfig>) {
  if (!config.http.enabled) return undefined;

  const server = buildServer(config);
  const transport = new StreamableHTTPServerTransport();
  await server.connect(transport);

  const app = createMcpExpressApp({ host: config.http.host });
  app.post(config.http.path, (req, res) => transport.handleRequest(req, res, (req as any).body));
  app.get(config.http.ssePath, (req, res) => transport.handleRequest(req, res));

  const listener = app.listen(config.http.port, config.http.host, () => {
    console.log(
      `Griphook MCP HTTP listening on http://${config.http.host}:${config.http.port}${config.http.path} (SSE at ${config.http.ssePath})`,
    );
  });

  return async () => {
    listener.close();
    await server.close();
  };
}

export async function start() {
  const config = loadConfig();
  const closers: Array<() => Promise<void>> = [];

  try {
    const closeStdio = await startStdioServer(config);
    closers.push(closeStdio);
  } catch (err) {
    console.error("Failed to start Griphook MCP stdio server:", err);
  }

  try {
    const closeHttp = await startHttpServer(config);
    if (closeHttp) {
      closers.push(closeHttp);
    }
  } catch (err) {
    console.error("Failed to start Griphook MCP HTTP server:", err);
  }

  process.on("SIGINT", async () => {
    await Promise.allSettled(closers.map((close) => close()));
    process.exit(0);
  });
}

start().catch((err) => {
  console.error("Failed to start Griphook MCP server:", err);
  process.exit(1);
});
