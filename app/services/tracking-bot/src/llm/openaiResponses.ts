import OpenAI from "openai";
import type { ResponseInputItem, Tool as ResponsesTool } from "openai/resources/responses/responses";
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

// OpenAI reasoning models (gpt-5.x, codex, o-series) via the Responses API.
// Multi-turn state uses previous_response_id chaining, so only new items are
// sent each turn (server-side storage, OpenAI default retention).
const toResponsesTools = (tools: ToolDefinition[]): ResponsesTool[] =>
  tools.map((t) => ({
    type: "function",
    name: t.name,
    description: t.description,
    parameters: t.inputSchema as Record<string, unknown>,
    strict: false,
  }));

const reasoningEffort = (): OpenAI.ReasoningEffort => {
  const override = process.env.OPENAI_REASONING_EFFORT;
  if (override) return override as OpenAI.ReasoningEffort;
  const effort = config.models.effort;
  return effort === "max" ? "high" : effort;
};

const userItem = (text: string, images?: ImageInput[]): ResponseInputItem => {
  if (!images?.length) return { role: "user", content: text };
  return {
    role: "user",
    content: [
      ...images.map((img) => ({ type: "input_image" as const, image_url: `data:${img.mediaType};base64,${img.base64}`, detail: "auto" as const })),
      { type: "input_text" as const, text },
    ],
  };
};

const supportsReasoning = (model: string): boolean => /^(gpt-5|o[1-9]|codex)/.test(model) || /codex/.test(model);

export class OpenAIResponsesClient implements LlmClient {
  readonly label: string;
  private readonly client: OpenAI;

  constructor(private readonly model: string, apiKey: string, baseURL?: string) {
    this.client = new OpenAI({ apiKey, baseURL, maxRetries: 3, timeout: 20 * 60 * 1000 });
    this.label = `openai:${model}`;
  }

  private base(system: string, tools: ToolDefinition[]) {
    return {
      model: this.model,
      instructions: system,
      tools: toResponsesTools(tools),
      max_output_tokens: MAX_OUTPUT_TOKENS,
      ...(supportsReasoning(this.model) ? { reasoning: { effort: reasoningEffort() } } : {}),
    };
  }

  private async request(params: OpenAI.Responses.ResponseCreateParamsNonStreaming, label: string): Promise<OpenAI.Responses.Response> {
    return withRetry(`${this.label} ${label}`, async () => {
      const response = await this.client.responses.create(params);
      if (response.status === "failed" || response.error) {
        throw new LlmError(`Response failed: ${response.error?.message ?? response.status}`);
      }
      if (response.status === "incomplete" && response.incomplete_details?.reason === "content_filter") {
        throw new LlmError("Response blocked by content filter");
      }
      return response;
    });
  }

  async structured<T>(options: StructuredOptions<T>): Promise<T> {
    const tool: ToolDefinition = { name: options.name, description: options.description, inputSchema: options.schema };
    const response = await this.request(
      {
        ...this.base(options.system, [tool]),
        input: [userItem(options.user, options.images)],
        tool_choice: { type: "function", name: options.name },
        store: false,
      },
      `structured:${options.name}`
    );
    const call = response.output.find(
      (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call" && item.name === options.name
    );
    if (!call) throw new LlmError(`No ${options.name} function call in response`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(call.arguments || "{}");
    } catch (error) {
      throw new LlmError(`Malformed JSON in ${options.name} arguments: ${error}`);
    }
    return options.validate ? options.validate(parsed) : (parsed as T);
  }

  createSession(options: SessionOptions): AgentSession {
    const base = this.base(options.system, options.tools);
    const usage = { inputTokens: 0, outputTokens: 0 };
    let previousResponseId: string | undefined;
    let turns = 0;
    const label = options.label ?? "session";

    const send = async (userMessage: string, images?: ImageInput[]): Promise<TurnResult> => {
      let input: ResponseInputItem[] = [userItem(userMessage, images)];
      let localTurns = 0;
      while (true) {
        if (turns >= options.maxTurns) {
          return { finalText: "", stoppedBy: "max_turns", turns: localTurns, usage };
        }
        turns++;
        localTurns++;
        const response = await this.request(
          { ...base, input, previous_response_id: previousResponseId, store: true },
          `${label} turn ${turns}`
        );
        previousResponseId = response.id;
        usage.inputTokens += response.usage?.input_tokens ?? 0;
        usage.outputTokens += response.usage?.output_tokens ?? 0;
        const text = response.output_text ?? "";
        if (text && options.onText) options.onText(text);

        const calls = response.output.filter(
          (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call"
        );
        if (calls.length === 0) {
          if (response.status === "incomplete" && response.incomplete_details?.reason === "max_output_tokens") {
            input = [{ role: "user", content: "You hit the output token limit mid-response. Continue from where you stopped." }];
            continue;
          }
          return { finalText: text, stoppedBy: "end_turn", turns: localTurns, usage };
        }
        const outputs: ResponseInputItem[] = [];
        let stopInput: Record<string, unknown> | undefined;
        for (const call of calls) {
          let parsedInput: Record<string, unknown> = {};
          try {
            parsedInput = JSON.parse(call.arguments || "{}");
          } catch {
            outputs.push({ type: "function_call_output", call_id: call.call_id, output: "Error: arguments were not valid JSON" });
            continue;
          }
          options.onToolCall?.(call.name, parsedInput);
          if (options.stopTool && call.name === options.stopTool) {
            stopInput = parsedInput;
            outputs.push({ type: "function_call_output", call_id: call.call_id, output: "Acknowledged." });
            continue;
          }
          try {
            const result = await options.execute(call.name, parsedInput);
            outputs.push({
              type: "function_call_output",
              call_id: call.call_id,
              output: (result.isError ? "ERROR: " : "") + result.content,
            });
          } catch (error) {
            outputs.push({ type: "function_call_output", call_id: call.call_id, output: `Tool crashed: ${error instanceof Error ? error.message : String(error)}` });
          }
        }
        input = outputs;
        if (stopInput) {
          // Deliver the acknowledgements so the chain stays consistent for follow-ups
          const ack = await this.request({ ...base, input, previous_response_id: previousResponseId, store: true, tool_choice: "none" }, `${label} ack`);
          previousResponseId = ack.id;
          return { finalText: text, stopToolInput: stopInput, stoppedBy: "stop_tool", turns: localTurns, usage };
        }
      }
    };
    log.info("LLM", `${this.label}: session ${label} created`);
    return { send };
  }
}
