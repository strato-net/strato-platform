import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { MercataApiClient } from "./client.js";
import { registerMercataTools } from "./tools.js";
import { registerMercataResources } from "./resources.js";

function buildServer(config: ReturnType<typeof loadConfig>) {
  const instructions = [
    "Mercata MCP server exposes the Mercata web app backend. Authentication requires an OAuth access token supplied via MERCATA_ACCESS_TOKEN.",
    `API base: ${config.apiBaseUrl}. Override with MERCATA_API_BASE_URL.`,
    "Use mercata.api-request for arbitrary endpoints; domain tools (mercata.tokens, mercata.swap, mercata.lending, mercata.cdp, mercata.bridge, mercata.rewards, mercata.admin, mercata.events, mercata.protocol-fees, mercata.rpc) provide common workflows.",
    `HTTP transport: ${config.http.enabled ? `POST ${config.http.host}:${config.http.port}${config.http.path}` : "disabled (set MERCATA_MCP_HTTP_ENABLED=true)"}.`,
  ].join("\n");

  const server = new McpServer(
    { name: "mercata-mcp", version: "0.1.0" },
    { capabilities: { logging: {} }, instructions },
  );

  const client = new MercataApiClient(config);

  registerMercataResources(server, config);
  registerMercataTools(server, client, config);

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
      `Mercata MCP HTTP listening on http://${config.http.host}:${config.http.port}${config.http.path} (SSE at ${config.http.ssePath})`,
    );
  });

  return async () => {
    listener.close();
    await server.close();
  };
}

async function start() {
  const config = loadConfig();
  const closers: Array<() => Promise<void>> = [];

  try {
    const closeStdio = await startStdioServer(config);
    closers.push(closeStdio);
  } catch (err) {
    console.error("Failed to start Mercata MCP stdio server:", err);
  }

  try {
    const closeHttp = await startHttpServer(config);
    if (closeHttp) {
      closers.push(closeHttp);
    }
  } catch (err) {
    console.error("Failed to start Mercata MCP HTTP server:", err);
  }

  process.on("SIGINT", async () => {
    await Promise.allSettled(closers.map((close) => close()));
    process.exit(0);
  });
}

start().catch((err) => {
  console.error("Failed to start Mercata MCP server:", err);
  process.exit(1);
});
