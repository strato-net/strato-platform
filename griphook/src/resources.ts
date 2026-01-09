import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { endpointsOverview, buildConfigDoc } from "./docs.js";
import { GriphookConfig } from "./config.js";

export function registerResources(server: McpServer, config: GriphookConfig) {
  server.registerResource(
    "strato-endpoints",
    "strato://resources/endpoints",
    { mimeType: "text/markdown", description: "STRATO API endpoints mapped to UI features." },
    async () => ({
      contents: [
        {
          uri: "strato://resources/endpoints",
          text: endpointsOverview,
        },
      ],
    }),
  );

  server.registerResource(
    "strato-config",
    "strato://resources/config",
    { mimeType: "text/markdown", description: "Active MCP configuration and env hints." },
    async () => ({
      contents: [
        {
          uri: "strato://resources/config",
          text: buildConfigDoc(config),
        },
      ],
    }),
  );
}
