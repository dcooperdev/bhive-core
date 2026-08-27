import { RawToolCall } from '../types';

export type ProviderHint = 'gemini' | 'openai' | 'anthropic' | 'ollama' | 'auto';

function safeParseJSON(text: unknown): Record<string, unknown> {
  if (typeof text !== 'string' || text.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    console.warn('   ⚠️  ToolCallingParser: could not JSON.parse tool call arguments, using {}');
    return {};
  }
}

/**
 * ToolCallingParser - the single place that turns a raw provider HTTP
 * response into normalized RawToolCall[]. Every adapter in
 * src/llm/adapters/ calls this instead of hand-rolling its own extraction,
 * so "how do I read a tool call out of provider X's response" only has
 * one implementation to get right (and to unit-test - see
 * tests/llm/ToolCallingParser.test.ts).
 *
 * `hint` should normally be passed explicitly by the calling adapter
 * ('gemini' | 'openai' | 'anthropic' | 'ollama'); 'auto' (the default)
 * is a best-effort shape sniff for callers that don't know the source,
 * e.g. tests exercising several formats in a loop.
 */
export class ToolCallingParser {
  static parseFunctionCalls(response: unknown, hint: ProviderHint = 'auto'): RawToolCall[] {
    if (!response || typeof response !== 'object') return [];
    const r = response as Record<string, unknown>;

    if ((hint === 'gemini' || hint === 'auto') && ToolCallingParser.looksLikeGemini(r)) {
      return ToolCallingParser.parseGemini(r);
    }
    if ((hint === 'openai' || hint === 'auto') && ToolCallingParser.looksLikeOpenAI(r)) {
      return ToolCallingParser.parseOpenAI(r);
    }
    if ((hint === 'anthropic' || hint === 'auto') && ToolCallingParser.looksLikeAnthropic(r)) {
      return ToolCallingParser.parseAnthropic(r);
    }
    if ((hint === 'ollama' || hint === 'auto') && ToolCallingParser.looksLikeOllama(r)) {
      return ToolCallingParser.parseOllama(r);
    }
    return [];
  }

  // --- Gemini: candidates[0].content.parts[].functionCall ----------------
  private static looksLikeGemini(r: Record<string, unknown>): boolean {
    return Array.isArray(r.candidates);
  }

  private static parseGemini(r: Record<string, unknown>): RawToolCall[] {
    const candidates = r.candidates as Array<Record<string, any>> | undefined;
    const parts: Array<Record<string, any>> = candidates?.[0]?.content?.parts ?? [];
    const calls: RawToolCall[] = [];
    parts.forEach((part, index) => {
      const fc = part?.functionCall;
      if (fc?.name) {
        calls.push({ id: `gemini-${index}-${fc.name}`, name: fc.name, args: fc.args ?? {} });
      }
    });
    return calls;
  }

  // --- OpenAI: choices[0].message.tool_calls[] (+ legacy function_call) --
  private static looksLikeOpenAI(r: Record<string, unknown>): boolean {
    return Array.isArray(r.choices);
  }

  private static parseOpenAI(r: Record<string, unknown>): RawToolCall[] {
    const choices = r.choices as Array<Record<string, any>> | undefined;
    const message = choices?.[0]?.message ?? {};
    if (Array.isArray(message.tool_calls)) {
      return message.tool_calls
        .filter((c: any) => c?.function?.name)
        .map((c: any, index: number) => ({
          id: c.id ?? `openai-${index}`,
          name: c.function.name,
          args: safeParseJSON(c.function.arguments)
        }));
    }
    // Legacy single function_call (pre tool_calls API)
    if (message.function_call?.name) {
      return [{ id: 'openai-legacy-0', name: message.function_call.name, args: safeParseJSON(message.function_call.arguments) }];
    }
    return [];
  }

  // --- Anthropic: content[] blocks with type === 'tool_use' ---------------
  private static looksLikeAnthropic(r: Record<string, unknown>): boolean {
    return r.type === 'message' && Array.isArray(r.content);
  }

  private static parseAnthropic(r: Record<string, unknown>): RawToolCall[] {
    const blocks = (r.content as Array<Record<string, any>>) ?? [];
    return blocks
      .filter(block => block?.type === 'tool_use' && typeof block.name === 'string')
      .map(block => ({ id: block.id ?? `anthropic-${block.name}`, name: block.name, args: block.input ?? {} }));
  }

  // --- Ollama: message.tool_calls[] (OpenAI-shaped), best-effort ---------
  private static looksLikeOllama(r: Record<string, unknown>): boolean {
    return typeof r.message === 'object' && r.message !== null && !Array.isArray(r.choices);
  }

  private static parseOllama(r: Record<string, unknown>): RawToolCall[] {
    const message = r.message as Record<string, any>;
    const calls = message?.tool_calls ?? [];
    if (!Array.isArray(calls)) return [];
    return calls.map((c: any, index: number) => {
      const name = c?.function?.name ?? c?.name;
      const rawArgs = c?.function?.arguments ?? c?.args ?? {};
      const args = typeof rawArgs === 'string' ? safeParseJSON(rawArgs) : rawArgs ?? {};
      return { id: c?.id ?? `ollama-${index}`, name, args };
    }).filter((c: RawToolCall) => Boolean(c.name));
  }
}
