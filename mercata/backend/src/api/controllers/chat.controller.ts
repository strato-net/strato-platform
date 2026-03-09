import { NextFunction, Request, Response } from "express";
import axios from "axios";
import { griphookMcpTimeoutMs, griphookMcpUrl } from "../../config/config";

function extractJsonRpcFromSse(body: string): unknown {
  // MCP over HTTP may respond as SSE. Parse the latest `data:` JSON payload.
  const lines = body.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line.startsWith("data:")) continue;
    const jsonPart = line.slice("data:".length).trim();
    if (!jsonPart) continue;
    return JSON.parse(jsonPart);
  }
  throw new Error("MCP SSE response did not contain a JSON data payload");
}

class ChatController {
  static async proxyMcp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const accessToken = req.accessToken as string;
      const mcpSessionId = req.headers["mcp-session-id"] as string | undefined;

      const upstreamResponse = await axios.post(griphookMcpUrl, req.body, {
        timeout: Number.isFinite(griphookMcpTimeoutMs) ? griphookMcpTimeoutMs : 30000,
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${accessToken}`,
          ...(mcpSessionId ? { "mcp-session-id": mcpSessionId } : {}),
        },
        responseType: "text",
        validateStatus: () => true,
      });

      const nextSessionId = upstreamResponse.headers["mcp-session-id"] as string | undefined;
      if (nextSessionId) {
        res.setHeader("mcp-session-id", nextSessionId);
      }

      const contentType = String(upstreamResponse.headers["content-type"] || "").toLowerCase();
      let responseBody: unknown = upstreamResponse.data;

      if (typeof responseBody === "string") {
        if (contentType.includes("text/event-stream")) {
          responseBody = extractJsonRpcFromSse(responseBody);
        } else {
          try {
            responseBody = JSON.parse(responseBody);
          } catch {
            // Keep raw string for non-JSON responses.
          }
        }
      }

      res.status(upstreamResponse.status).json(responseBody);
    } catch (error) {
      next(error);
    }
  }
}

export default ChatController;
