import { Message, Tool } from '../types';

export interface LLMToolCall {
  name: string;
  params: any;
}

export interface LLMCompletionResult {
  content: string;
  toolCalls?: LLMToolCall[];
}

/**
 * LLMAdapter - Provider interface for a language model backend.
 *
 * Any backend (Gemini, OpenAI, Anthropic, Ollama, ...) can be plugged
 * into a Bee by implementing this interface. Bee/BeeManager depend only
 * on this contract, never on a concrete provider.
 */
export interface LLMAdapter {
  /** Identifies the backend, e.g. 'gemini', 'openai', 'anthropic', 'ollama'. */
  readonly name: string;

  complete(messages: Message[], tools?: Tool[]): Promise<LLMCompletionResult>;

  getTokens(): number;
  getCallCount(): number;
  resetStats(): void;

  setModel(model: string): void;
  getModel(): string;
}
