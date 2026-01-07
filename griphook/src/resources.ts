import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { endpointsOverview, buildConfigDoc } from "./docs.js";
import { MercataMcpConfig } from "./config.js";

export function registerMercataResources(server: McpServer, config: MercataMcpConfig) {
  server.registerResource(
    "mercata-endpoints",
    "mercata://resources/endpoints",
    { mimeType: "text/markdown", description: "Mercata API endpoints mapped to UI features." },
    async () => ({
      contents: [
        {
          uri: "mercata://resources/endpoints",
          text: endpointsOverview,
        },
      ],
    }),
  );

  server.registerResource(
    "mercata-config",
    "mercata://resources/config",
    { mimeType: "text/markdown", description: "Active MCP configuration and env hints." },
    async () => ({
      contents: [
        {
          uri: "mercata://resources/config",
          text: buildConfigDoc(config),
        },
      ],
    }),
  );
}
