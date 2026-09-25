/** A minimal JSON-schema-ish description of a tool's arguments. */
export interface ToolParameterSchema {
  type: 'object';
  properties: Record<string, { type: string; description?: string; enum?: string[] }>;
  required?: string[];
}

export interface ToolExecutionContext {
  /** Name of the Bee currently executing this tool. */
  beeName: string;
  /** Delegates a task to another registered agent and resolves with its output. */
  delegate: (agentName: string, task: string) => Promise<string>;
}

export interface Tool {
  name: string;
  description: string;
  /**
   * JSON-schema-ish description of this tool's arguments. Every LLMAdapter
   * uses this (via src/llm/toolCallingFormatters/*) to build the
   * provider-specific function/tool schema it sends upstream. Omit it for
   * a tool that takes no arguments - it defaults to an empty-object schema.
   */
  parameters?: ToolParameterSchema;
  execute: (params: any, context?: ToolExecutionContext) => Promise<string>;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

/** A tool call exactly as reported by an LLMAdapter - unvalidated. */
export interface RawToolCall {
  id: string;
  name: string;
  args: unknown;
}

/** A tool call that passed ToolCallValidator - safe to execute. */
export interface ValidatedToolCall {
  toolName: string;
  args: Record<string, unknown>;
  metadata: {
    id: string;
    beeName: string;
    validatedAt: number;
  };
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
  | 'security:unauthorized_delegation'
  | 'security:invalid_tool_call';

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
 * The shareable half of an agent's identity: what other Bees (and
 * BeeManager) look up in BeeIdentityManager to verify this Bee's
 * signatures and encrypt messages to it. Contains no secret material.
 *
 * All keys are base64 DER (SPKI for public keys, PKCS#8 for private keys).
 */
export interface BeePublicIdentity {
  beeName: string;
  /** Ed25519 public key. Verifies this Bee's MessageSigner signatures. */
  signingPublicKey: string;
  /** This Bee's *current* X25519 encryption public key. Rotates over time (see BeeKeyring). */
  encryptionPublicKey: string;
  /** Identifies `encryptionPublicKey`; carried in each encrypted envelope so the recipient knows which private key to use. */
  encryptionKeyId: string;
  /** Ed25519 signature (by `signingPublicKey`) over the current encryption key, so a registry can't substitute its own. */
  encryptionKeySignature: string;
  trustScore: number;
}

/**
 * An agent's full identity, including private keys: a point-in-time
 * snapshot of a BeeKeyring. Only the owning Bee's BeeKeyring hands this
 * out - BeeIdentityManager's lookups return BeePublicIdentity only.
 *
 * Signing (Ed25519) and encryption (X25519) use separate keypairs; the
 * encryption keypair rotates, the signing keypair is long-lived.
 */
export interface BeeIdentity extends BeePublicIdentity {
  /** Ed25519 private key. Used ONLY by MessageSigner.sign(). */
  signingPrivateKey: string;
  /** X25519 private key matching `encryptionPublicKey`. Used ONLY by MessageEncryption.decrypt(). */
  encryptionPrivateKey: string;
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
  /** Sender's one-time X25519 public key for this message, present whenever `encrypted` is true. */
  ephemeralPublicKey?: string;
  /** Which of the recipient's encryption keys this message was encrypted to, present whenever `encrypted` is true. */
  encryptionKeyId?: string;
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
  | 'unauthorized_delegation'
  | 'invalid_tool_call';

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
