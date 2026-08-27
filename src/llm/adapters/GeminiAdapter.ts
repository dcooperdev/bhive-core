import axios from 'axios';
import { Message, Tool } from '../../types';
import { LLMResponse } from '../../providers/LLMAdapter';
import { BaseLLMAdapter } from './BaseLLMAdapter';
import { ToolCallingParser } from '../ToolCallingParser';
import { toGeminiFunctionDeclarations } from '../toolCallingFormatters/geminiToolFormatter';

/**
 * GeminiAdapter - fixed version of the upstream @bhive-ai/core@0.4.0
 * default adapter, which never sent `tools` to the API and always
 * returned `toolCalls: []`. This one actually sends functionDeclarations
 * and parses functionCall parts back out via ToolCallingParser.
 */
export class GeminiAdapter extends BaseLLMAdapter {
  readonly name = 'gemini';
  private apiKey: string;
  private readonly baseURL = 'https://generativelanguage.googleapis.com/v1beta/models';

  constructor(apiKey?: string, model = 'gemini-flash-2.0', timeout?: number) {
    super(model, { envVar: 'GEMINI_TIMEOUT', timeout });
    this.apiKey = apiKey || process.env.GOOGLE_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('GOOGLE_API_KEY not set. Add it to your .env file.\nGet a free key at https://aistudio.google.com/app/apikey');
    }
  }

  async complete(messages: Message[], tools: Tool[] = []): Promise<LLMResponse> {
    const body: Record<string, unknown> = {
      contents: messages.map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] }))
    };
    if (tools.length > 0) {
      body.tools = [{ functionDeclarations: toGeminiFunctionDeclarations(tools) }];
    }

    try {
      const response = await axios.post(`${this.baseURL}/${this.model}:generateContent`, body, {
        headers: { 'Content-Type': 'application/json' },
        params: { key: this.apiKey },
        timeout: this.timeout
      });

      const toolCalls = ToolCallingParser.parseFunctionCalls(response.data, 'gemini');
      const parts: Array<Record<string, unknown>> = response.data?.candidates?.[0]?.content?.parts ?? [];
      const content = parts
        .filter(part => typeof part.text === 'string')
        .map(part => part.text as string)
        .join('');

      this.trackUsage(response.data?.usageMetadata?.totalTokenCount ?? 0);
      return { content, toolCalls };
    } catch (error) {
      // Rethrow the original axios error so Bee's callWithRetry() can
      // still read error.response.status for its 503 backoff logic.
      console.error('Gemini API error:', (error as Error).message);
      throw error;
    }
  }
}
