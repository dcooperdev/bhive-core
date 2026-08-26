export interface ToolExecutionContext {
  /** Name of the Bee currently executing this tool. */
  beeName: string;
  /** Delegates a task to another registered agent and resolves with its output. */
  delegate: (agentName: string, task: string) => Promise<string>;
}

export interface Tool {
  name: string;
  description: string;
  execute: (params: any, context?: ToolExecutionContext) => Promise<string>;
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
  | 'retry'
  | 'delegation:start'
  | 'delegation:complete'
  | 'delegation:error'
  | 'delegation:security_error'
  | 'security:injection_detected'
  | 'security:unauthorized_delegation';

export interface BeeEvent {
  id: string;
  timestamp: Date;
  beeName: string;
  type: BeeEventType;
  data: Record<string, unknown>;
}

export interface DelegationRequest {
  from: string;
  to: string;
  task: string;
  timestamp: Date;
  /** Present only when the BeeManager was configured with signing and/or encryption enabled. */
  secureMessage?: SecureAgentMessage;
}

/**
 * How freely a Bee may delegate to other agents.
 * - 'open': delegate to any agent registered with its BeeManager.
 * - 'careful': delegate only to names listed in its `allowedDelegates`.
 * - 'strict': never delegate; tools only.
 */
export type TrustLevel = 'open' | 'careful' | 'strict';

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

// --- Secure Agent Communication (v0.4.0) -----------------------------------

/**
 * An agent's cryptographic identity. `privateKey` is an RSA-2048 PEM used
 * both for hybrid encryption (unwrapping messages addressed to this Bee)
 * and as the HMAC secret for signing this Bee's own messages. It never
 * leaves the BeeIdentityManager that issued it.
 */
export interface BeeIdentity {
  beeName: string;
  publicKey: string;
  privateKey: string;
  trustScore: number;
}

/**
 * A message between agents, optionally signed and/or encrypted. All
 * security fields are optional so a message with none of them set is
 * just a plain, unsigned, unencrypted payload (v0.3 behavior).
 */
export interface SecureAgentMessage {
  id: string;
  from: string;
  to: string;
  timestamp: number;
  data: unknown;
  signature?: string;
  nonce?: string;
  encrypted?: boolean;
  iv?: string;
  authTag?: string;
  /** RSA-OAEP-wrapped AES-256 key, present whenever `encrypted` is true. */
  encryptedKey?: string;
}

export interface SecurityConfig {
  enableEncryption?: boolean;
  enableSigning?: boolean;
  trustLevel?: TrustLevel;
}

/** Configuration shape consumed by the BeeSecurityContext class. */
export interface BeeSecurityContextConfig {
  /** Whitelist used when trustLevel is 'careful'. */
  allowedDelegates?: string[];
  /** Reject messages whose serialized data exceeds this many bytes. Default 1MB. */
  maxMessageSize?: number;
  /** Reject messages once this many have been sent within the last 60s. */
  maxMessagesPerMinute?: number;
  /** Whitelist of tool names this Bee may invoke. Empty = no restriction. */
  allowedTools?: string[];
  trustLevel?: TrustLevel;
  /** Sandboxing flag for callers that want to isolate this Bee's execution. */
  isolated?: boolean;
}

/** One link in a hash chain proving a sequence of messages wasn't tampered with or reordered. */
export interface AttestationChain {
  messageId: string;
  from: string;
  to: string;
  timestamp: number;
  signature: string;
  previousHash: string;
  hash: string;
}

export type AuditEventType =
  | 'message_sent'
  | 'message_received'
  | 'signature_verified'
  | 'signature_failed'
  | 'injection_detected'
  | 'rate_limit_exceeded'
  | 'unauthorized_delegation';

export interface AuditEntry {
  id: string;
  timestamp: Date;
  beeName: string;
  type: AuditEventType;
  detail: string;
  metadata?: Record<string, unknown>;
}

/** Result of scanning untrusted text for prompt-injection patterns. */
export interface SafePrompt {
  original: string;
  sanitized: string;
  /** 0 (clean) to 1 (highly suspicious). */
  injectionRisk: number;
  /** Source of each pattern that matched. */
  patterns: string[];
}
