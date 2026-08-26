import { SafePrompt } from '../types';

interface InjectionPattern {
  source: string;
  regex: RegExp;
}

// Each pattern is matched case-insensitively and globally (for sanitization).
const INJECTION_PATTERNS: InjectionPattern[] = [
  { source: 'ignore.*instructions', regex: /ignore.*instructions/gi },
  { source: 'bypass.*security', regex: /bypass.*security/gi },
  { source: 'system.*override', regex: /system.*override/gi },
  { source: 'execute.*code', regex: /execute.*code/gi },
  { source: 'forget.*prompt', regex: /forget.*prompt/gi }
];

const HIGH_RISK_THRESHOLD = 0.7;
const RISK_PER_MATCH = 0.35;

/**
 * PromptInjectionDetector - scans untrusted text for common prompt
 * injection patterns before it ever reaches an LLM.
 *
 * This is heuristic, not exhaustive: it catches the well-known phrasing
 * patterns listed in the spec, not every possible injection technique.
 * Treat it as one layer of defense, not the only one.
 */
export class PromptInjectionDetector {
  detectInjection(input: string): SafePrompt {
    const matchedPatterns: string[] = [];
    let sanitized = input;

    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.regex.test(input)) {
        matchedPatterns.push(pattern.source);
        sanitized = sanitized.replace(pattern.regex, '[REDACTED]');
      }
      pattern.regex.lastIndex = 0; // reset shared regex state between calls
    }

    const injectionRisk = Math.min(1, matchedPatterns.length * RISK_PER_MATCH);

    if (injectionRisk > HIGH_RISK_THRESHOLD) {
      console.warn(
        `   🚨 High-risk prompt injection detected (risk=${injectionRisk.toFixed(2)}): ${matchedPatterns.join(', ')}`
      );
    }

    return { original: input, sanitized, injectionRisk, patterns: matchedPatterns };
  }
}
