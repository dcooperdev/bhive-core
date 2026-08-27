import { Message, RawToolCall, Tool } from '../types';

/**
 * LLMResponse - what every LLMAdapter.complete() resolves with.
 *
 * `toolCalls` is always an array (never undefined) so callers don't need
 * an `?? []` at every call site - an LLM turn with no tool calls resolves
 * with `toolCalls: []`. Each entry is a RawToolCall exactly as reported by
 * the provider (unvalidated) - Bee.ts runs it through ToolCallValidator
 * before ever looking it up in the Bee's toolset.
 *
 * Provider mapping (see src/llm/ToolCallingParser.ts for the parsing side):
 *   Gemini:    candidates[0].content.parts[].functionCall            -> {id: synthetic, name, args}
 *   OpenAI:    choices[0].message.tool_calls[].function              -> {id, name, args: JSON.parse(arguments)}
 *   Anthropic: content[] blocks where type === 'tool_use'            -> {id, name, args: input}
 *   Ollama:    message.tool_calls[].function (OpenAI-shaped, best-effort) -> {id, name, args}
 */
export interface LLMResponse {
  content: string;
  toolCalls: RawToolCall[];
}

/** @deprecated kept only so code written against the older shape still compiles; identical to LLMResponse. */
export type LLMCompletionResult = LLMResponse;

/**
 * LLMAdapter - Provider interface for a language model backend.
 *
 * Any backend can be plugged into a Bee by implementing this interface.
 * Bee/BeeManager depend only on this contract, never on a concrete
 * provider - see src/llm/adapters/ for the Gemini/OpenAI/Anthropic/Ollama
 * implementations and src/llm/providerRegistry.ts for how BeeManager picks
 * one automatically from `llmProvider` / `LLM_PROVIDER`.
 *
 * Implementations MUST:
 *  - send `tools` to the provider in that provider's native tool/function
 *    format (use a helper from src/llm/toolCallingFormatters/), when tools
 *    is non-empty;
 *  - run the raw provider response through
 *    `ToolCallingParser.parseFunctionCalls(response, providerHint)` rather
 *    than hand-rolling parsing, so all adapters stay consistent;
 *  - rethrow the original error from a failed HTTP call (not a wrapped
 *    Error) so Bee's 503 retry logic can still read `error.response.status`.
 */
export interface LLMAdapter {
  /** Identifies the backend, e.g. 'gemini', 'openai', 'anthropic', 'ollama'. */
  readonly name: string;
  /**
   * Per-request HTTP timeout in ms for the built-in adapters. Resolved once at
   * construction from (most specific first): an explicit constructor argument,
   * a provider-specific env var (`GEMINI_TIMEOUT`, `OPENAI_TIMEOUT`,
   * `ANTHROPIC_TIMEOUT`, `OLLAMA_TIMEOUT`), the generic `BEE_TIMEOUT`, then the
   * adapter default (60s; 120s for Ollama). Optional - a custom adapter need
   * not expose it.
   */
  readonly timeout?: number;
  complete(messages: Message[], tools?: Tool[]): Promise<LLMResponse>;
  getTokens(): number;
  getCallCount(): number;
  resetStats(): void;
  setModel(model: string): void;
  getModel(): string;
}
