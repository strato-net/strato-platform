import { config, ModelSpec } from "../config";
import { AnthropicClient } from "./anthropic";
import { OpenAIChatClient } from "./openaiChat";
import { OpenAIResponsesClient } from "./openaiResponses";
import { LlmClient } from "./types";

const cache = new Map<string, LlmClient>();

const need = (value: string | undefined, name: string): string => {
  if (!value) throw new Error(`${name} is required for the configured model`);
  return value;
};

// Any Claude model via the Anthropic SDK; any GPT/Codex/o-series model via the
// OpenAI Responses API; Grok via xAI's OpenAI-compatible chat endpoint; and a
// generic OpenAI-compatible slot (OpenRouter, Ollama, vLLM, ...).
export const getClient = (spec: ModelSpec): LlmClient => {
  const key = `${spec.provider}:${spec.model}`;
  const cached = cache.get(key);
  if (cached) return cached;
  let client: LlmClient;
  switch (spec.provider) {
    case "anthropic":
      client = new AnthropicClient(spec.model, need(config.models.anthropicApiKey, "ANTHROPIC_API_KEY"));
      break;
    case "openai":
      client = new OpenAIResponsesClient(spec.model, need(config.models.openaiApiKey, "OPENAI_API_KEY"));
      break;
    case "xai":
      client = new OpenAIChatClient(
        "xai",
        spec.model,
        need(config.models.xaiApiKey, "XAI_API_KEY"),
        config.models.xaiBaseUrl,
        process.env.XAI_REASONING_EFFORT
      );
      break;
    case "openai-compatible":
      client = new OpenAIChatClient(
        "openai-compatible",
        spec.model,
        need(config.models.openaiCompatibleApiKey, "OPENAI_COMPAT_API_KEY"),
        need(config.models.openaiCompatibleBaseUrl, "OPENAI_COMPAT_BASE_URL"),
        process.env.OPENAI_COMPAT_REASONING_EFFORT
      );
      break;
  }
  cache.set(key, client);
  return client;
};

export const triageClient = (): LlmClient => getClient(config.models.triage);
export const implementClient = (): LlmClient => getClient(config.models.implement);
