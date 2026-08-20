import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { log } from "../log";
import { withRetry } from "./retry";
import {
  AgentSession,
  ImageInput,
  LlmClient,
  LlmError,
  SessionOptions,
  StructuredOptions,
  ToolDefinition,
  TurnResult,
} from "./types";

const MAX_OUTPUT_TOKENS = 32_000;

// Adaptive thinking exists on the 4.6+ / 5 families; older ids get no
// thinking parameter at all.
const supportsAdaptiveThinking = (model: string): boolean =>
  !/haiku|-4-5|-4-1|-4-0|-3-|claude-3/.test(model);

const toAnthropicTools = (tools: ToolDefinition[]): Anthropic.Tool[] =>
  tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool.InputSchema }));

const userContent = (text: string, images?: ImageInput[]): Anthropic.MessageParam["content"] => {
  if (!images?.length) return text;
  return [
    ...images.map((img): Anthropic.ImageBlockParam => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } })),
    { type: "text", text },
  ];
};

const textOf = (message: Anthropic.Message): string =>
  message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

export class AnthropicClient implements LlmClient {
  readonly label: string;
  private readonly client: Anthropic;

  constructor(private readonly model: string, apiKey: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 3, timeout: 20 * 60 * 1000 });
    this.label = `anthropic:${model}`;
  }

  private baseParams(system: string, tools: ToolDefinition[]): Omit<Anthropic.MessageCreateParamsStreaming, "messages"> {
    const params: Omit<Anthropic.MessageCreateParamsStreaming, "messages"> = {
      model: this.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      tools: toAnthropicTools(tools),
      stream: true,
      cache_control: { type: "ephemeral" },
    };
    if (supportsAdaptiveThinking(this.model)) {
      params.thinking = { type: "adaptive" };
      params.output_config = { effort: config.models.effort };
    }
    return params;
  }

  private async request(params: Anthropic.MessageCreateParamsStreaming, label: string): Promise<Anthropic.Message> {
    return withRetry(`${this.label} ${label}`, async () => {
      const stream = this.client.messages.stream(params);
      const message = await stream.finalMessage();
      if (message.stop_reason === "refusal") {
        throw new LlmError(`Model refused (${message.stop_details?.category ?? "unknown"}): ${message.stop_details?.explanation ?? ""}`);
      }
      return message;
    });
  }

  async structured<T>(options: StructuredOptions<T>): Promise<T> {
    const tool: ToolDefinition = { name: options.name, description: options.description, inputSchema: options.schema };
    const params: Anthropic.MessageCreateParamsStreaming = {
      ...this.baseParams(options.system, [tool]),
      tool_choice: { type: "tool", name: options.name },
      messages: [{ role: "user", content: userContent(options.user, options.images) }],
    };
    const message = await this.request(params, `structured:${options.name}`);
    const call = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === options.name);
    if (!call) throw new LlmError(`No ${options.name} tool call in response (stop_reason=${message.stop_reason})`);
    return options.validate ? options.validate(call.input) : (call.input as T);
  }

  createSession(options: SessionOptions): AgentSession {
    const messages: Anthropic.MessageParam[] = [];
    const usage = { inputTokens: 0, outputTokens: 0 };
    let turns = 0;
    const base = this.baseParams(options.system, options.tools);
    const label = options.label ?? "session";

    const send = async (userMessage: string, images?: ImageInput[]): Promise<TurnResult> => {
      messages.push({ role: "user", content: userContent(userMessage, images) });
      let localTurns = 0;
      while (true) {
        if (turns >= options.maxTurns) {
          return { finalText: "", stoppedBy: "max_turns", turns: localTurns, usage };
        }
        turns++;
        localTurns++;
        const message = await this.request({ ...base, messages }, `${label} turn ${turns}`);
        usage.inputTokens += message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0);
        usage.outputTokens += message.usage.output_tokens;
        const text = textOf(message);
        if (text && options.onText) options.onText(text);
        messages.push({ role: "assistant", content: message.content });

        const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
        if (message.stop_reason === "max_tokens") {
          messages.push({ role: "user", content: "You hit the output token limit mid-response. Continue from where you stopped." });
          continue;
        }
        if (toolUses.length === 0) {
          return { finalText: text, stoppedBy: "end_turn", turns: localTurns, usage };
        }
        const results: Anthropic.ToolResultBlockParam[] = [];
        let stopInput: Record<string, unknown> | undefined;
        for (const call of toolUses) {
          const input = (call.input ?? {}) as Record<string, unknown>;
          options.onToolCall?.(call.name, input);
          if (options.stopTool && call.name === options.stopTool) {
            stopInput = input;
            results.push({ type: "tool_result", tool_use_id: call.id, content: "Acknowledged." });
            continue;
          }
          try {
            const result = await options.execute(call.name, input);
            results.push({ type: "tool_result", tool_use_id: call.id, content: result.content, is_error: result.isError ?? false });
          } catch (error) {
            results.push({ type: "tool_result", tool_use_id: call.id, content: `Tool crashed: ${error instanceof Error ? error.message : String(error)}`, is_error: true });
          }
        }
        messages.push({ role: "user", content: results });
        if (stopInput) {
          return { finalText: text, stopToolInput: stopInput, stoppedBy: "stop_tool", turns: localTurns, usage };
        }
        if (message.stop_reason === "pause_turn") continue;
      }
    };
    log.info("LLM", `${this.label}: session ${label} created`);
    return { send };
  }
}
