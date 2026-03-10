import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import MobileBottomNav from "@/components/dashboard/MobileBottomNav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/axios";
import { Bot, Send } from "lucide-react";

type ChatRole = "assistant" | "user";

type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
};

type McpTool = {
  name: string;
  description?: string;
};

type JsonRpcResponse = {
  result?: any;
  error?: { message?: string };
};

type AgentResponse = {
  answer?: string;
  toolName?: string;
};

const MAX_RENDERED_MESSAGE_CHARS = 6000;
const MAX_HISTORY_MESSAGES = 8;
const MAX_HISTORY_MESSAGE_CHARS = 1200;

const truncateText = (text: string, maxChars: number): string => {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trimEnd()}\n\n[truncated]`;
};

const AssistantPage = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "I’m Griphook, your Mercata execution agent. I can inspect live balances, rewards, swaps, bridge paths, vault positions, and lending data, then run tool calls on request.\n\nAgent commands: /tools, /call <tool> <json-args>, /help",
    },
  ]);
  const [input, setInput] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [initialized, setInitialized] = useState(false);
  const nextRequestId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = "Griphook Agent | STRATO";
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const addMessage = (role: ChatRole, text: string) => {
    const normalizedText = truncateText(text, MAX_RENDERED_MESSAGE_CHARS);
    setMessages((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        role,
        text: normalizedText,
      },
    ]);
  };

  const mcpPost = async (payload: Record<string, unknown>): Promise<JsonRpcResponse> => {
    const response = await api.post("/chat/mcp", payload, {
      headers: sessionId ? { "mcp-session-id": sessionId } : undefined,
    });
    const nextSessionId = response.headers["mcp-session-id"] as string | undefined;
    if (nextSessionId && nextSessionId !== sessionId) {
      setSessionId(nextSessionId);
    }
    return response.data;
  };

  const mcpRequest = async (method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse> => {
    const id = nextRequestId.current++;
    return mcpPost({
      jsonrpc: "2.0",
      id,
      method,
      ...(params ? { params } : {}),
    });
  };

  const agentPost = async (message: string): Promise<AgentResponse> => {
    const history = messages
      .filter((item) => item.role === "user" || item.role === "assistant")
      .slice(-MAX_HISTORY_MESSAGES)
      .map((item) => ({ role: item.role, text: truncateText(item.text, MAX_HISTORY_MESSAGE_CHARS) }));

    const response = await api.post(
      "/chat/agent",
      { message, history },
      { headers: sessionId ? { "mcp-session-id": sessionId } : undefined }
    );
    const nextSessionId = response.headers["mcp-session-id"] as string | undefined;
    if (nextSessionId && nextSessionId !== sessionId) {
      setSessionId(nextSessionId);
    }
    return response.data as AgentResponse;
  };

  const initializeMcp = async () => {
    if (initialized) return;

    const initResponse = await mcpRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mercata-assistant", version: "1.0.0" },
    });

    if (initResponse.error) {
      throw new Error(initResponse.error.message || "Failed to initialize MCP");
    }

    await mcpPost({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    });

    const toolsResponse = await mcpRequest("tools/list", {});
    if (toolsResponse.error) {
      throw new Error(toolsResponse.error.message || "Failed to fetch tools");
    }

    const listedTools = (toolsResponse.result?.tools || []) as McpTool[];
    setTools(listedTools);
    setInitialized(true);
  };

  const pickReadOnlyTool = (text: string): { name: string; args: Record<string, unknown> } => {
    const normalized = text.toLowerCase();

    if (normalized.includes("reward")) return { name: "strato.rewards", args: {} };
    if (normalized.includes("borrow") || normalized.includes("lend") || normalized.includes("loan")) {
      return { name: "strato.lending", args: {} };
    }
    if (normalized.includes("vault") || normalized.includes("cdp")) {
      return { name: "strato.cdp", args: {} };
    }
    if (normalized.includes("bridge") || normalized.includes("withdraw") || normalized.includes("deposit")) {
      return { name: "strato.bridge", args: { includeSummary: true } };
    }
    if (normalized.includes("swap") || normalized.includes("liquidity") || normalized.includes("pool")) {
      return { name: "strato.swap", args: { includePositions: true } };
    }

    return {
      name: "strato.tokens",
      args: { includeBalances: true, includeEarningAssets: true, includeStats: true },
    };
  };

  const runTool = async (name: string, args: Record<string, unknown>) => {
    const response = await mcpRequest("tools/call", {
      name,
      arguments: args,
    });

    if (response.error) {
      throw new Error(response.error.message || `Tool call failed: ${name}`);
    }

    const content = response.result?.content;
    if (Array.isArray(content)) {
      const textParts = content
        .map((item) => (typeof item?.text === "string" ? item.text : JSON.stringify(item)))
        .join("\n\n");
      addMessage("assistant", textParts || JSON.stringify(response.result, null, 2));
      return;
    }

    addMessage("assistant", JSON.stringify(response.result ?? response, null, 2));
  };

  const toolsSummary = useMemo(() => {
    if (tools.length === 0) return "No tools loaded yet.";
    return tools
      .slice(0, 24)
      .map((tool) => `- ${tool.name}${tool.description ? `: ${tool.description}` : ""}`)
      .join("\n");
  }, [tools]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || isWorking) return;

    addMessage("user", text);
    setInput("");
    setIsWorking(true);

    try {
      if (text === "/help") {
        addMessage(
          "assistant",
          "Use /tools to list available MCP tools, or /call <tool> <json-args> for explicit calls.\nWithout commands, your prompt goes through the GPT-backed agent."
        );
      } else if (text === "/tools") {
        await initializeMcp();
        addMessage("assistant", toolsSummary);
      } else if (text.startsWith("/call ")) {
        await initializeMcp();
        const match = text.match(/^\/call\s+([^\s]+)(?:\s+([\s\S]+))?$/);
        if (!match) {
          addMessage("assistant", "Invalid call syntax. Use: /call <tool> <json-args>");
        } else {
          const toolName = match[1];
          const argsJson = match[2];
          const args = argsJson ? JSON.parse(argsJson) : {};
          await runTool(toolName, args);
        }
      } else {
        const response = await agentPost(text);
        const answer =
          typeof response.answer === "string" && response.answer.trim()
            ? response.answer
            : "No assistant response.";
        addMessage("assistant", answer);
      }
    } catch (error: any) {
      addMessage("assistant", `Request failed: ${error?.message || "Unknown error"}`);
    } finally {
      setIsWorking(false);
    }
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <DashboardSidebar />

      <div className="transition-all duration-300" style={{ paddingLeft: "var(--sidebar-width, 0px)" }}>
        <DashboardHeader title="Griphook Agent" />
        <main className="p-4 md:p-6">
          <div className="mx-auto max-w-5xl">
            <Card className="border border-border shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Bot className="h-5 w-5" />
                  Griphook Agent
                </CardTitle>
                <CardDescription>
                  Uses your active STRATO login, MCP tool data, and GPT for natural-language responses.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="h-[480px] overflow-y-auto rounded-md border bg-muted/20 p-4">
                  <div className="space-y-3">
                    {messages.map((message) => (
                      <div
                        key={message.id}
                        className={`max-w-[92%] rounded-md p-3 text-sm whitespace-pre-wrap ${
                          message.role === "user"
                            ? "ml-auto bg-blue-600 text-white"
                            : "bg-card border border-border text-foreground"
                        }`}
                      >
                        {message.text}
                      </div>
                    ))}
                    <div ref={endRef} />
                  </div>
                </div>

                <form className="space-y-3" onSubmit={handleSubmit}>
                  <Textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={handleInputKeyDown}
                    placeholder="Ask about balances, rewards, swaps, bridge, vault, lending, or use /call..."
                    className="min-h-[96px]"
                  />
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      Commands: /tools, /call &lt;tool&gt; &lt;json-args&gt;, /help. Enter sends, Shift+Enter new line.
                    </p>
                    <Button type="submit" disabled={isWorking || !input.trim()}>
                      <Send className="mr-2 h-4 w-4" />
                      {isWorking ? "Running..." : "Send"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default AssistantPage;
