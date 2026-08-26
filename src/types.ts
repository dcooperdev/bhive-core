export interface Tool {
  name: string;
  description: string;
  execute: (params: any) => Promise<string>;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface ToolCall {
  toolName: string;
  params: any;
  result: string;
}

export interface AgentRun {
  agent: string;
  input: string;
  toolCalls: ToolCall[];
  output: string;
  tokensUsed: number;
  timestamp: Date;
}

export type BeeEventType =
  | 'run:enqueued'
  | 'run:start'
  | 'run:complete'
  | 'run:error'
  | 'queue:full'
  | 'queue:expired'
  | 'retry';

export interface BeeEvent {
  id: string;
  timestamp: Date;
  beeName: string;
  type: BeeEventType;
  data: Record<string, unknown>;
}

export interface QueueConfig {
  /** Use a StorageProvider-backed list instead of an in-memory array. */
  persist?: boolean;
  /** Storage key for the persisted queue. Defaults to `bee:{name}:queue`. */
  persistenceKey?: string;
  /** Reject new work once the queue reaches this many pending items. */
  maxSize?: number;
  /** Drop items that have waited longer than this many ms before they run. */
  ttl?: number;
}
