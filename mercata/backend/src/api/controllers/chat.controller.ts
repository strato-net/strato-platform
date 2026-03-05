import { NextFunction, Request, Response } from "express";
import axios from "axios";
import { griphookMcpTimeoutMs, griphookMcpUrl } from "../../config/config";

class ChatController {
  static async proxyMcp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const accessToken = req.accessToken as string;
      const mcpSessionId = req.headers["mcp-session-id"] as string | undefined;

      const upstreamResponse = await axios.post(griphookMcpUrl, req.body, {
        timeout: Number.isFinite(griphookMcpTimeoutMs) ? griphookMcpTimeoutMs : 30000,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
          ...(mcpSessionId ? { "mcp-session-id": mcpSessionId } : {}),
        },
        validateStatus: () => true,
      });

      const nextSessionId = upstreamResponse.headers["mcp-session-id"] as string | undefined;
      if (nextSessionId) {
        res.setHeader("mcp-session-id", nextSessionId);
      }

      res.status(upstreamResponse.status).json(upstreamResponse.data);
    } catch (error) {
      next(error);
    }
  }
}

export default ChatController;
