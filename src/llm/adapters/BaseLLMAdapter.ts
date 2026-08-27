import { Message, Tool } from '../../types';
import { LLMAdapter, LLMResponse } from '../../providers/LLMAdapter';

/** Default per-request HTTP timeout for every adapter when nothing overrides it. */
export const DEFAULT_ADAPTER_TIMEOUT_MS = 60_000;

export interface TimeoutOptions {
  /** Provider-specific env var checked before the generic BEE_TIMEOUT, e.g. 'GEMINI_TIMEOUT'. */
  envVar?: string;
  /** Explicit value from a constructor argument - wins over every env var. */
  timeout?: number;
  /** Adapter-specific default when neither a constructor arg nor an env var is set. Defaults to DEFAULT_ADAPTER_TIMEOUT_MS. */
  fallbackMs?: number;
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Resolves an adapter's request timeout, most-specific source first:
 *   1. explicit constructor argument
 *   2. provider-specific env var (GEMINI_TIMEOUT, OPENAI_TIMEOUT, ...)
 *   3. generic BEE_TIMEOUT env var
 *   4. the adapter's own fallback (60s, or 120s for Ollama)
 */
export function resolveTimeout({ envVar, timeout, fallbackMs }: TimeoutOptions): number {
  if (typeof timeout === 'number' && timeout > 0) return timeout;
  return (
    (envVar ? parsePositiveInt(process.env[envVar]) : undefined) ??
    parsePositiveInt(process.env.BEE_TIMEOUT) ??
    fallbackMs ??
    DEFAULT_ADAPTER_TIMEOUT_MS
  );
}

/** Shared bookkeeping (token/call counters, model name, request timeout) for every concrete adapter. */
export abstract class BaseLLMAdapter implements LLMAdapter {
  abstract readonly name: string;
  protected model: string;
  protected totalTokens = 0;
  protected callCount = 0;
  /** Per-request HTTP timeout in ms, passed to axios by each concrete adapter. */
  readonly timeout: number;

  constructor(model: string, timeoutOptions: TimeoutOptions = {}) {
    this.model = model;
    this.timeout = resolveTimeout(timeoutOptions);
  }

  abstract complete(messages: Message[], tools?: Tool[]): Promise<LLMResponse>;

  protected trackUsage(tokens: number): void {
    this.totalTokens += tokens;
    this.callCount++;
  }

  getTokens(): number {
    return this.totalTokens;
  }

  getCallCount(): number {
    return this.callCount;
  }

  resetStats(): void {
    this.totalTokens = 0;
    this.callCount = 0;
  }

  setModel(model: string): void {
    this.model = model;
  }

  getModel(): string {
    return this.model;
  }
}
