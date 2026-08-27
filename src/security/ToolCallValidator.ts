import { randomUUID } from 'crypto';
import { RawToolCall, Tool, ValidatedToolCall } from '../types';

const MAX_ARGS_BYTES = 64 * 1024; // arbitrary but generous ceiling - real tool args are small
const MAX_CONTROL_CHAR_CODE = 31; // C0 control range is 0x00-0x1F

// Same phrasing family as PromptInjectionDetector, applied to tool
// arguments specifically: a tool call's args are model-authored text that
// downstream Tool.execute() implementations may interpolate into prompts,
// shell commands, or file paths, so they get scanned too, not just the
// original user input.
const SUSPICIOUS_ARG_PATTERNS: RegExp[] = [
  /ignore.*instructions/gi,
  /system.*override/gi,
  /bypass.*security/gi
];

// Keys that, if present anywhere in a parsed JSON args object, could
// pollute Object.prototype if a downstream Tool naively does
// `{...defaults, ...args}` or `Object.assign(target, args)`.
const PROTOTYPE_POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Tab (9), newline (10) and carriage-return (13) are legitimate whitespace
// inside JSON string values - every other C0 control character is not.
const ALLOWED_CONTROL_CODES = new Set([9, 10, 13]);

export type ToolCallValidationResult = { valid: true; call: ValidatedToolCall } | { valid: false; reason: string };

/**
 * ToolCallValidator - the one place every tool call from any LLMAdapter
 * passes through before Bee.ts ever calls `tool.execute()`.
 *
 * Provider-agnostic on purpose: it operates on the normalized RawToolCall
 * shape (see src/llm/ToolCallingParser.ts), so it doesn't matter whether
 * the call originated from Gemini's functionCall, OpenAI's tool_calls, or
 * Anthropic's tool_use - the same checks apply everywhere.
 */
export class ToolCallValidator {
  /**
   * Validates a raw tool call against the calling Bee's actual toolset.
   * `allowedToolNames`, when given, additionally enforces a Bee's
   * BeeSecurityContext tool whitelist (empty/undefined = no restriction).
   */
  validate(rawCall: RawToolCall, availableTools: Tool[], beeName: string, allowedToolNames?: string[]): ToolCallValidationResult {
    if (!rawCall || typeof rawCall.name !== 'string' || rawCall.name.trim().length === 0) {
      return { valid: false, reason: 'Tool call is missing a name' };
    }

    const tool = availableTools.find(t => t.name === rawCall.name);
    if (!tool) {
      return { valid: false, reason: `Tool "${rawCall.name}" is not registered on Bee "${beeName}"` };
    }

    if (allowedToolNames && allowedToolNames.length > 0 && !allowedToolNames.includes(rawCall.name)) {
      return { valid: false, reason: `Tool "${rawCall.name}" is not in Bee "${beeName}"'s allowed tool list` };
    }

    const args = rawCall.args ?? {};
    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
      return { valid: false, reason: `Tool "${rawCall.name}" arguments must be a JSON object, got ${Array.isArray(args) ? 'array' : typeof args}` };
    }

    const pollutionKey = this.findPrototypePollutionKey(args as Record<string, unknown>);
    if (pollutionKey) {
      return { valid: false, reason: `Tool "${rawCall.name}" arguments contain a disallowed key "${pollutionKey}"` };
    }

    const sizeIssue = this.checkArgsPayload(args);
    if (sizeIssue) {
      return { valid: false, reason: `Tool "${rawCall.name}" arguments rejected: ${sizeIssue}` };
    }

    const injectionPattern = this.findInjectionPattern(args);
    if (injectionPattern) {
      return {
        valid: false,
        reason: `Tool "${rawCall.name}" arguments look like a prompt-injection attempt (matched "${injectionPattern}")`
      };
    }

    return {
      valid: true,
      call: {
        toolName: rawCall.name,
        args: args as Record<string, unknown>,
        metadata: { id: rawCall.id || randomUUID(), beeName, validatedAt: Date.now() }
      }
    };
  }

  /**
   * Checks the args payload for oversized input and disallowed control
   * characters. Size is measured on the JSON-serialized form (a fair,
   * unicode-safe byte count); control characters are checked on the raw
   * string values themselves - JSON.stringify would already have escaped
   * a real control byte into a harmless six-character "\\u0007" sequence,
   * so scanning the serialized text would never catch it.
   */
  private checkArgsPayload(args: unknown): string | null {
    const serialized = JSON.stringify(args);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_ARGS_BYTES) {
      return `arguments exceed the maximum allowed size of ${MAX_ARGS_BYTES} bytes`;
    }
    if (this.containsControlCharacters(args)) {
      return 'arguments contain control characters';
    }
    return null;
  }

  private containsControlCharacters(value: unknown, depth = 0): boolean {
    if (depth > 10 || value === null || value === undefined) return false;
    if (typeof value === 'string') {
      for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code <= MAX_CONTROL_CHAR_CODE && !ALLOWED_CONTROL_CODES.has(code)) return true;
      }
      return false;
    }
    if (Array.isArray(value)) {
      return value.some(item => this.containsControlCharacters(item, depth + 1));
    }
    if (typeof value === 'object') {
      return Object.values(value as Record<string, unknown>).some(item => this.containsControlCharacters(item, depth + 1));
    }
    return false;
  }

  private findInjectionPattern(args: unknown): string | null {
    const serialized = JSON.stringify(args);
    for (const pattern of SUSPICIOUS_ARG_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(serialized)) return pattern.source;
    }
    return null;
  }

  private findPrototypePollutionKey(obj: Record<string, unknown>, depth = 0): string | null {
    if (depth > 10 || obj === null || typeof obj !== 'object') return null;
    for (const key of Object.keys(obj)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) return key;
      const value = obj[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const nested = this.findPrototypePollutionKey(value as Record<string, unknown>, depth + 1);
        if (nested) return nested;
      }
    }
    return null;
  }
}
