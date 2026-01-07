import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { MercataApiClient } from "./client.js";
import { registerMercataTools } from "./tools.js";
import { registerMercataResources } from "./resources.js";

async function start() {
  const config = loadConfig();
  const instructions = [
    "Mercata MCP server exposes the Mercata web app backend. Authentication requires an OAuth access token supplied via MERCATA_ACCESS_TOKEN.",
    `API base: ${config.apiBaseUrl}. Override with MERCATA_API_BASE_URL.`,
    "Use mercata.api-request for arbitrary endpoints; domain tools (mercata.tokens, mercata.swap, mercata.lending, mercata.cdp, mercata.bridge, mercata.rewards, mercata.admin, mercata.events, mercata.protocol-fees, mercata.rpc) provide common workflows.",
  ].join("\n");

  const server = new McpServer(
    { name: "mercata-mcp", version: "0.1.0" },
    { capabilities: { logging: {} }, instructions },
  );

  const client = new MercataApiClient(config);

  registerMercataResources(server, config);
  registerMercataTools(server, client, config);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
  });
}

start().catch((err) => {
  console.error("Failed to start Mercata MCP server:", err);
  process.exit(1);
});
