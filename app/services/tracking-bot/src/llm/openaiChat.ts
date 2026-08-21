import OpenAI from "openai";
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

// Chat Completions with function calling — the lingua franca of xAI (Grok),
// OpenRouter, Ollama, vLLM, and any other OpenAI-compatible endpoint.
const toChatTools = (tools: ToolDefinition[]): OpenAI.Chat.Completions.ChatCompletionTool[] =>
  tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.inputSchema as Record<string, unknown> },
  }));

const userMessage = (text: string, images?: ImageInput[]): OpenAI.Chat.Completions.ChatCompletionUserMessageParam => {
  if (!images?.length) return { role: "user", content: text };
  return {
    role: "user",
    content: [
      ...images.map((img) => ({ type: "image_url" as const, image_url: { url: `data:${img.mediaType};base64,${img.base64}` } })),
      { type: "text" as const, text },
    ],
  };
};

export class OpenAIChatClient implements LlmClient {
  readonly label: string;
  private readonly client: OpenAI;

  constructor(
    providerLabel: string,
    private readonly model: string,
    apiKey: string,
    baseURL: string,
    private readonly reasoningEffort?: string
  ) {
    this.client = new OpenAI({ apiKey, baseURL, maxRetries: 3, timeout: 20 * 60 * 1000 });
    this.label = `${providerLabel}:${model}`;
  }

  private base(tools: ToolDefinition[]) {
    return {
      model: this.model,
      tools: toChatTools(tools),
      ...(this.reasoningEffort ? { reasoning_effort: this.reasoningEffort as OpenAI.ReasoningEffort } : {}),
    };
  }

  private async request(
    params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
    label: string
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    return withRetry(`${this.label} ${label}`, async () => {
      const completion = await this.client.chat.completions.create(params);
      if (!completion.choices?.length) throw new LlmError("Empty choices in completion");
      if (completion.choices[0].finish_reason === "content_filter") throw new LlmError("Completion blocked by content filter");
      return completion;
    });
  }

  async structured<T>(options: StructuredOptions<T>): Promise<T> {
    const tool: ToolDefinition = { name: options.name, description: options.description, inputSchema: options.schema };
    const completion = await this.request(
      {
        ...this.base([tool]),
        messages: [
          { role: "system", content: options.system },
          userMessage(options.user, options.images),
        ],
        tool_choice: { type: "function", function: { name: options.name } },
      },
      `structured:${options.name}`
    );
    const call = completion.choices[0].message.tool_calls?.find((c) => c.type === "function" && c.function.name === options.name);
    if (!call || call.type !== "function") throw new LlmError(`No ${options.name} tool call in completion`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(call.function.arguments || "{}");
    } catch (error) {
      throw new LlmError(`Malformed JSON in ${options.name} arguments: ${error}`);
    }
    return options.validate ? options.validate(parsed) : (parsed as T);
  }

  createSession(options: SessionOptions): AgentSession {
    const base = this.base(options.tools);
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [{ role: "system", content: options.system }];
    const usage = { inputTokens: 0, outputTokens: 0 };
    let turns = 0;
    const label = options.label ?? "session";

    const send = async (text: string, images?: ImageInput[]): Promise<TurnResult> => {
      messages.push(userMessage(text, images));
      let localTurns = 0;
      while (true) {
        if (turns >= options.maxTurns) {
          return { finalText: "", stoppedBy: "max_turns", turns: localTurns, usage };
        }
        turns++;
        localTurns++;
        const completion = await this.request({ ...base, messages }, `${label} turn ${turns}`);
        usage.inputTokens += completion.usage?.prompt_tokens ?? 0;
        usage.outputTokens += completion.usage?.completion_tokens ?? 0;
        const choice = completion.choices[0];
        const assistant = choice.message;
        const text = typeof assistant.content === "string" ? assistant.content : "";
        if (text && options.onText) options.onText(text);
        messages.push({
          role: "assistant",
          content: assistant.content ?? null,
          ...(assistant.tool_calls?.length ? { tool_calls: assistant.tool_calls } : {}),
        });

        const calls = (assistant.tool_calls ?? []).filter((c) => c.type === "function");
        if (calls.length === 0) {
          if (choice.finish_reason === "length") {
            messages.push({ role: "user", content: "You hit the output token limit mid-response. Continue from where you stopped." });
            continue;
          }
          return { finalText: text, stoppedBy: "end_turn", turns: localTurns, usage };
        }
        let stopInput: Record<string, unknown> | undefined;
        for (const call of calls) {
          if (call.type !== "function") continue;
          let parsedInput: Record<string, unknown> = {};
          try {
            parsedInput = JSON.parse(call.function.arguments || "{}");
          } catch {
            messages.push({ role: "tool", tool_call_id: call.id, content: "Error: arguments were not valid JSON" });
            continue;
          }
          options.onToolCall?.(call.function.name, parsedInput);
          if (options.stopTool && call.function.name === options.stopTool) {
            stopInput = parsedInput;
            messages.push({ role: "tool", tool_call_id: call.id, content: "Acknowledged." });
            continue;
          }
          try {
            const result = await options.execute(call.function.name, parsedInput);
            messages.push({ role: "tool", tool_call_id: call.id, content: (result.isError ? "ERROR: " : "") + result.content });
          } catch (error) {
            messages.push({ role: "tool", tool_call_id: call.id, content: `Tool crashed: ${error instanceof Error ? error.message : String(error)}` });
          }
        }
        if (stopInput) {
          return { finalText: text, stopToolInput: stopInput, stoppedBy: "stop_tool", turns: localTurns, usage };
        }
      }
    };
    log.info("LLM", `${this.label}: session ${label} created`);
    return { send };
  }
}
