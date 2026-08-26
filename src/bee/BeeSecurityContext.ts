import { BeeSecurityContextConfig, TrustLevel } from '../types';

export interface MessageValidationResult {
  valid: boolean;
  reason?: string;
}

const DEFAULT_MAX_MESSAGE_SIZE = 1_000_000; // 1MB
const DEFAULT_MAX_MESSAGES_PER_MINUTE = 1000; // generous default; tighten explicitly for real limits
const RATE_WINDOW_MS = 60_000;

/**
 * BeeSecurityContext - per-Bee security policy: delegation whitelist,
 * message size limits, rate limiting, tool whitelist, trust level, and
 * an isolation flag callers can use to sandbox execution.
 *
 * A Bee constructed with no explicit context gets a fully permissive
 * one ('open' trust, no whitelist, generous limits) - existing v0.3
 * behavior is unaffected unless you opt into stricter settings.
 */
export class BeeSecurityContext {
  allowedDelegates: string[];
  maxMessageSize: number;
  maxMessagesPerMinute: number;
  allowedTools: string[];
  trustLevel: TrustLevel;
  isolated: boolean;

  private messageTimestamps: number[] = [];

  constructor(config: BeeSecurityContextConfig = {}) {
    this.allowedDelegates = config.allowedDelegates ?? [];
    this.maxMessageSize = config.maxMessageSize ?? DEFAULT_MAX_MESSAGE_SIZE;
    this.maxMessagesPerMinute = config.maxMessagesPerMinute ?? DEFAULT_MAX_MESSAGES_PER_MINUTE;
    this.allowedTools = config.allowedTools ?? [];
    this.trustLevel = config.trustLevel ?? 'open';
    this.isolated = config.isolated ?? false;
  }

  /** Rejects messages whose serialized data exceeds maxMessageSize. */
  validateMessage(message: { data: unknown }): MessageValidationResult {
    const size = Buffer.byteLength(JSON.stringify(message.data ?? null), 'utf8');

    if (size > this.maxMessageSize) {
      return { valid: false, reason: `Message size ${size} bytes exceeds maxMessageSize of ${this.maxMessageSize} bytes` };
    }

    return { valid: true };
  }

  /**
   * Records one message/delegation attempt and returns whether it's
   * within the configured per-minute limit. Sliding 60s window.
   */
  checkRateLimit(): boolean {
    const now = Date.now();
    this.messageTimestamps = this.messageTimestamps.filter(t => now - t < RATE_WINDOW_MS);

    if (this.messageTimestamps.length >= this.maxMessagesPerMinute) {
      return false;
    }

    this.messageTimestamps.push(now);
    return true;
  }

  /** Whether this Bee's trust level permits delegating to `delegateName` right now. */
  isAllowedDelegate(delegateName: string): boolean {
    if (this.trustLevel === 'strict') return false;
    if (this.trustLevel === 'careful') return this.allowedDelegates.includes(delegateName);
    return true; // 'open'
  }

  /** Whether this Bee is permitted to invoke a tool named `toolName`. Empty whitelist = no restriction. */
  isToolAllowed(toolName: string): boolean {
    if (this.allowedTools.length === 0) return true;
    return this.allowedTools.includes(toolName);
  }
}
