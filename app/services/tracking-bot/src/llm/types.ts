// Provider-agnostic surface. Two operations cover everything the bot needs:
//   structured(): one forced tool call whose input matches a JSON schema
//                 (classification, decisions, comment drafting)
//   createSession(): a tool-using agent loop with persistent history
//                 (planning with read-only tools, implementation, fix rounds)

export interface JsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
}

export type ToolExecutor = (name: string, input: Record<string, unknown>) => Promise<ToolResult>;

export interface SessionOptions {
  system: string;
  tools: ToolDefinition[];
  execute: ToolExecutor;
  maxTurns: number;
  // Calling this tool ends the run (its input is returned as stopToolInput)
  stopTool?: string;
  onText?: (text: string) => void;
  onToolCall?: (name: string, input: Record<string, unknown>) => void;
  label?: string;
}

export interface TurnResult {
  finalText: string;
  stopToolInput?: Record<string, unknown>;
  stoppedBy: "end_turn" | "stop_tool" | "max_turns";
  turns: number;
  usage: { inputTokens: number; outputTokens: number };
}

export interface ImageInput {
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  base64: string;
}

export interface AgentSession {
  send(userMessage: string, images?: ImageInput[]): Promise<TurnResult>;
}

export interface StructuredOptions<T> {
  system: string;
  user: string;
  images?: ImageInput[];
  name: string;
  description: string;
  schema: JsonSchema;
  validate?: (value: unknown) => T;
}

export interface LlmClient {
  readonly label: string;
  structured<T = Record<string, unknown>>(options: StructuredOptions<T>): Promise<T>;
  createSession(options: SessionOptions): AgentSession;
}

export class LlmError extends Error {}
