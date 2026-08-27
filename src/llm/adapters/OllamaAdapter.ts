import axios from 'axios';
import { Message, Tool } from '../../types';
import { LLMResponse } from '../../providers/LLMAdapter';
import { BaseLLMAdapter } from './BaseLLMAdapter';
import { ToolCallingParser } from '../ToolCallingParser';
import { toOpenAITools } from '../toolCallingFormatters/openaiToolFormatter';

/**
 * OllamaAdapter - local/self-hosted models via Ollama's /api/chat.
 *
 * Best-effort tool-calling: only a subset of models Ollama can run
 * (e.g. llama3.1, mistral-nemo, qwen2.5) actually support the `tools`
 * field at all. Others silently ignore it and just answer in plain text -
 * this adapter still returns a well-formed LLMResponse (`toolCalls: []`)
 * in that case rather than throwing, so a Bee configured with tools still
 * runs, it just never gets to use them with a model that can't call them.
 */
export class OllamaAdapter extends BaseLLMAdapter {
  readonly name = 'ollama';
  private readonly baseURL: string;

  constructor(model = 'llama3.1', baseURL?: string, timeout?: number) {
    // Local models on modest hardware are routinely slower than a hosted API,
    // so Ollama's fallback timeout is 120s rather than the shared 60s default.
    super(model, { envVar: 'OLLAMA_TIMEOUT', timeout, fallbackMs: 120_000 });
    this.baseURL = baseURL || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  }

  async complete(messages: Message[], tools: Tool[] = []): Promise<LLMResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: false
    };
    if (tools.length > 0) {
      // Ollama's /api/chat tool schema mirrors OpenAI's function-calling shape.
      body.tools = toOpenAITools(tools);
    }

    try {
      const response = await axios.post(`${this.baseURL}/api/chat`, body, { timeout: this.timeout });

      const toolCalls = ToolCallingParser.parseFunctionCalls(response.data, 'ollama');
      const content = response.data?.message?.content ?? '';

      const tokens = (response.data?.eval_count ?? 0) + (response.data?.prompt_eval_count ?? 0);
      this.trackUsage(tokens);
      return { content, toolCalls };
    } catch (error) {
      if (axios.isAxiosError(error) && !error.response) {
        throw new Error(`Could not reach Ollama at ${this.baseURL} - is it running? (${error.message})`);
      }
      console.error('Ollama API error:', (error as Error).message);
      throw error;
    }
  }
}
