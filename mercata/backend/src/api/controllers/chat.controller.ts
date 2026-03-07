import { NextFunction, Request, Response } from "express";
import axios from "axios";
import {
  gptApiBase,
  gptApiKey,
  gptModel,
  gptTimeoutMs,
  griphookMcpTimeoutMs,
  griphookMcpUrl,
} from "../../config/config";

type ToolChoice = {
  name: string;
  arguments: Record<string, unknown>;
};

type AgentHistoryMessage = {
  role: "user" | "assistant";
  text: string;
};

type McpResponse = {
  status: number;
  body: unknown;
  nextSessionId?: string;
};

type ErrorWithStatus = Error & {
  status?: number;
};

const MAX_AGENT_INPUT_CHARS = 2000;
const MAX_AGENT_HISTORY_ITEMS = 8;
const MAX_AGENT_HISTORY_TEXT_CHARS = 1200;
const MAX_TOOL_OUTPUT_PROMPT_CHARS = 16000;
const MAX_AGENT_ANSWER_CHARS = 2400;
const GPT_MAX_TOKENS = 380;

function truncateText(text: string, maxChars: number): string {
  const normalized = typeof text === "string" ? text : String(text ?? "");
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars).trimEnd()}\n\n[truncated]`;
}

function extractJsonRpcFromSse(body: string): unknown {
  const events = body
    .split(/\r?\n\r?\n/)
    .map((eventBlock) => eventBlock.trim())
    .filter(Boolean);

  for (let i = events.length - 1; i >= 0; i -= 1) {
    const dataLines = events[i]
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());

    if (dataLines.length === 0) continue;

    const payload = dataLines.join("\n").trim();
    if (!payload) continue;

    try {
      return JSON.parse(payload);
    } catch {
      // Keep scanning for a valid JSON chunk.
    }
  }

  throw new Error("MCP SSE response did not contain a JSON data payload");
}

function createHttpError(status: number, message: string): ErrorWithStatus {
  const error = new Error(message) as ErrorWithStatus;
  error.status = status;
  return error;
}

function normalizeMcpResponseBody(contentType: string, data: string): unknown {
  if (contentType.includes("text/event-stream")) {
    return extractJsonRpcFromSse(data);
  }

  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

function extractMcpErrorMessage(status: number, body: unknown): string {
  if (body && typeof body === "object") {
    const errorObj = (body as { error?: { message?: string } }).error;
    if (typeof errorObj?.message === "string" && errorObj.message.trim()) {
      return errorObj.message;
    }
  }
  if (typeof body === "string" && body.trim()) {
    return body;
  }
  return `MCP upstream request failed with status ${status}`;
}

function extractToolText(body: unknown): string {
  if (body && typeof body === "object") {
    const content = (body as { result?: { content?: Array<{ text?: string }> } }).result?.content;
    if (Array.isArray(content)) {
      const text = content
        .map((item) => (typeof item?.text === "string" ? item.text : ""))
        .filter(Boolean)
        .join("\n\n")
        .trim();
      if (text) return text;
    }
  }

  if (typeof body === "string") return body;

  try {
    return JSON.stringify(body, null, 2);
  } catch {
    return "No tool output available.";
  }
}

function pickReadOnlyTool(input: string): ToolChoice {
  const normalized = input.toLowerCase();

  if (normalized.includes("reward")) return { name: "strato.rewards", arguments: {} };
  if (normalized.includes("borrow") || normalized.includes("lend") || normalized.includes("loan")) {
    return { name: "strato.lending", arguments: {} };
  }
  if (normalized.includes("vault") || normalized.includes("cdp")) {
    return { name: "strato.cdp", arguments: {} };
  }
  if (normalized.includes("bridge") || normalized.includes("withdraw") || normalized.includes("deposit")) {
    return { name: "strato.bridge", arguments: { includeSummary: true } };
  }
  if (normalized.includes("swap") || normalized.includes("liquidity") || normalized.includes("pool")) {
    return { name: "strato.swap", arguments: { includePositions: true } };
  }

  return {
    name: "strato.tokens",
    arguments: { includeBalances: true, includeEarningAssets: true, includeStats: true },
  };
}

class ChatController {
  private static async postMcp(
    accessToken: string,
    payload: Record<string, unknown>,
    mcpSessionId?: string
  ): Promise<McpResponse> {
    const upstreamResponse = await axios.post(griphookMcpUrl, payload, {
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

    const contentType = String(upstreamResponse.headers["content-type"] || "").toLowerCase();
    const body = normalizeMcpResponseBody(contentType, upstreamResponse.data);
    const nextSessionId = upstreamResponse.headers["mcp-session-id"] as string | undefined;

    return {
      status: upstreamResponse.status,
      body,
      nextSessionId,
    };
  }

  private static async initializeMcpSession(accessToken: string, sessionId?: string): Promise<string | undefined> {
    const initializePayload = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "mercata-assistant", version: "1.0.0" },
      },
    };

    const initResponse = await ChatController.postMcp(accessToken, initializePayload, sessionId);
    const nextSessionId = initResponse.nextSessionId || sessionId;

    if (initResponse.status >= 400) {
      throw createHttpError(initResponse.status, extractMcpErrorMessage(initResponse.status, initResponse.body));
    }

    const initializedPayload = {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    };

    const initializedResponse = await ChatController.postMcp(accessToken, initializedPayload, nextSessionId);
    const finalSessionId = initializedResponse.nextSessionId || nextSessionId;

    if (initializedResponse.status >= 400) {
      throw createHttpError(
        initializedResponse.status,
        extractMcpErrorMessage(initializedResponse.status, initializedResponse.body)
      );
    }

    return finalSessionId;
  }

  private static async summarizeWithGpt(
    message: string,
    history: AgentHistoryMessage[],
    toolChoice: ToolChoice,
    toolOutput: unknown
  ): Promise<string> {
    const fallbackText = truncateText(extractToolText(toolOutput), MAX_AGENT_ANSWER_CHARS);

    if (!gptApiKey) {
      return fallbackText;
    }

    const sanitizedHistory = history
      .filter((item) => (item.role === "user" || item.role === "assistant") && typeof item.text === "string")
      .slice(-MAX_AGENT_HISTORY_ITEMS)
      .map((item) => ({
        role: item.role,
        content: truncateText(item.text, MAX_AGENT_HISTORY_TEXT_CHARS),
      }));

    const toolOutputText = truncateText(extractToolText(toolOutput), MAX_TOOL_OUTPUT_PROMPT_CHARS);

    const prompt = [
      `User question: ${message}`,
      `Tool used: ${toolChoice.name}`,
      `Tool args JSON: ${JSON.stringify(toolChoice.arguments)}`,
      "Tool output JSON:",
      toolOutputText,
      "",
      "Respond as a concise Mercata assistant.",
      "Give a direct answer, and call out uncertainty if data may be incomplete or stale.",
    ].join("\n");

    try {
      const response = await axios.post(
        `${gptApiBase.replace(/\/$/, "")}/chat/completions`,
        {
          model: gptModel,
          temperature: 0.2,
          max_tokens: GPT_MAX_TOKENS,
          messages: [
            {
              role: "system",
              content:
                "You are the Mercata in-app assistant. Use provided tool output to answer accurately. Be concise, practical, and avoid long dumps.",
            },
            ...sanitizedHistory,
            { role: "user", content: prompt },
          ],
        },
        {
          timeout: Number.isFinite(gptTimeoutMs) ? gptTimeoutMs : 30000,
          headers: {
            authorization: `Bearer ${gptApiKey}`,
            "content-type": "application/json",
          },
        }
      );

      const data = response.data as {
        choices?: Array<{
          message?: {
            content?: string | Array<{ type?: string; text?: string }>;
          };
        }>;
      };

      const content = data?.choices?.[0]?.message?.content;
      if (typeof content === "string" && content.trim()) {
        return truncateText(content.trim(), MAX_AGENT_ANSWER_CHARS);
      }
      if (Array.isArray(content)) {
        const text = content
          .map((part) => (typeof part?.text === "string" ? part.text : ""))
          .filter(Boolean)
          .join("\n")
          .trim();
        if (text) return truncateText(text, MAX_AGENT_ANSWER_CHARS);
      }
    } catch (error: any) {
      const status = error?.response?.status;
      const message = error?.message || "Unknown error";
      console.warn(
        `[chat/agent] GPT summarization failed${status ? ` (status ${status})` : ""}: ${message}. Falling back to tool output.`
      );
    }

    return fallbackText;
  }

  static async proxyMcp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const accessToken = req.accessToken as string;
      const mcpSessionId = req.headers["mcp-session-id"] as string | undefined;
      const payload = (req.body || {}) as Record<string, unknown>;
      const upstreamResponse = await ChatController.postMcp(accessToken, payload, mcpSessionId);

      if (upstreamResponse.nextSessionId) {
        res.setHeader("mcp-session-id", upstreamResponse.nextSessionId);
      }

      if (upstreamResponse.body !== null && typeof upstreamResponse.body === "object") {
        res.status(upstreamResponse.status).json(upstreamResponse.body);
      } else {
        res.status(upstreamResponse.status).send(upstreamResponse.body);
      }
    } catch (error) {
      next(error);
    }
  }

  static async agentReply(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const accessToken = req.accessToken as string;
      const mcpSessionId = req.headers["mcp-session-id"] as string | undefined;
      const body = (req.body || {}) as { message?: string; history?: AgentHistoryMessage[] };
      const message =
        typeof body.message === "string" ? truncateText(body.message.trim(), MAX_AGENT_INPUT_CHARS) : "";
      const history = Array.isArray(body.history)
        ? body.history
            .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.text === "string")
            .slice(-MAX_AGENT_HISTORY_ITEMS)
            .map((item) => ({
              role: item.role,
              text: truncateText(item.text, MAX_AGENT_HISTORY_TEXT_CHARS),
            }))
        : [];

      if (!message) {
        throw createHttpError(400, "message is required");
      }

      const sessionId = await ChatController.initializeMcpSession(accessToken, mcpSessionId);
      const toolChoice = pickReadOnlyTool(message);
      const toolPayload = {
        jsonrpc: "2.0",
        id: Date.now() + 1,
        method: "tools/call",
        params: {
          name: toolChoice.name,
          arguments: toolChoice.arguments,
        },
      };

      const toolResponse = await ChatController.postMcp(accessToken, toolPayload, sessionId);
      const nextSessionId = toolResponse.nextSessionId || sessionId;
      if (nextSessionId) {
        res.setHeader("mcp-session-id", nextSessionId);
      }

      if (toolResponse.status >= 400) {
        throw createHttpError(toolResponse.status, extractMcpErrorMessage(toolResponse.status, toolResponse.body));
      }

      const answer = await ChatController.summarizeWithGpt(message, history, toolChoice, toolResponse.body);

      res.status(200).json({
        answer,
        toolName: toolChoice.name,
      });
    } catch (error) {
      next(error);
    }
  }
}

export default ChatController;
