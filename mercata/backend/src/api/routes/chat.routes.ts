import { Router } from "express";
import authHandler from "../middleware/authHandler";
import ChatController from "../controllers/chat.controller";

const router = Router();

/**
 * @openapi
 * /chat/mcp:
 *   post:
 *     summary: Proxy MCP JSON-RPC requests to Griphook using the active user session token
 *     tags: [Chat]
 *     responses:
 *       200:
 *         description: MCP response payload
 *       401:
 *         description: Unauthorized
 */
router.post("/mcp", authHandler.authorizeRequest(), ChatController.proxyMcp);

/**
 * @openapi
 * /chat/agent:
 *   post:
 *     summary: Ask the GPT-backed assistant (uses MCP tools and returns a natural-language answer)
 *     tags: [Chat]
 *     responses:
 *       200:
 *         description: Assistant response payload
 *       401:
 *         description: Unauthorized
 */
router.post("/agent", authHandler.authorizeRequest(), ChatController.agentReply);

export default router;
