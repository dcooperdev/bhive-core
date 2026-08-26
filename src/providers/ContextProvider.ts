/**
 * ContextProvider - Agnostic persistence for a Bee's conversational
 * context (e.g. prior messages), so state can survive across runs and
 * across process restarts when backed by a durable store.
 */
export interface ContextProvider {
  /** Identifies the backend, e.g. 'redis', 'mongodb', 'postgresql', 'memory'. */
  readonly name: string;

  getContext<T = unknown>(key: string): Promise<T | undefined>;
  setContext<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void>;
  deleteContext(key: string): Promise<void>;
  hasContext(key: string): Promise<boolean>;
}
