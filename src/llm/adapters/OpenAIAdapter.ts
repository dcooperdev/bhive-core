import axios from 'axios';
import { Message, Tool } from '../../types';
import { LLMResponse } from '../../providers/LLMAdapter';
import { BaseLLMAdapter } from './BaseLLMAdapter';
import { ToolCallingParser } from '../ToolCallingParser';
import { toOpenAITools } from '../toolCallingFormatters/openaiToolFormatter';

/** OpenAIAdapter - Chat Completions API with real tool-calling (tools + tool_calls). */
export class OpenAIAdapter extends BaseLLMAdapter {
  readonly name = 'openai';
  private apiKey: string;
  private readonly baseURL: string;

  constructor(apiKey?: string, model = 'gpt-4o-mini', baseURL = 'https://api.openai.com/v1', timeout?: number) {
    super(model, { envVar: 'OPENAI_TIMEOUT', timeout });
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || '';
    this.baseURL = baseURL;
    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY not set. Add it to your .env file.\nGet a key at https://platform.openai.com/api-keys');
    }
  }

  async complete(messages: Message[], tools: Tool[] = []): Promise<LLMResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map(m => ({ role: m.role, content: m.content }))
    };
    if (tools.length > 0) {
      body.tools = toOpenAITools(tools);
      body.tool_choice = 'auto';
    }

    try {
      const response = await axios.post(`${this.baseURL}/chat/completions`, body, {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        timeout: this.timeout
      });

      const toolCalls = ToolCallingParser.parseFunctionCalls(response.data, 'openai');
      const content = response.data?.choices?.[0]?.message?.content ?? '';

      this.trackUsage(response.data?.usage?.total_tokens ?? 0);
      return { content, toolCalls };
    } catch (error) {
      console.error('OpenAI API error:', (error as Error).message);
      throw error;
    }
  }
}
