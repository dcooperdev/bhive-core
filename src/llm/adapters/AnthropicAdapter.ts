import axios from 'axios';
import { Message, Tool } from '../../types';
import { LLMResponse } from '../../providers/LLMAdapter';
import { BaseLLMAdapter } from './BaseLLMAdapter';
import { ToolCallingParser } from '../ToolCallingParser';
import { toAnthropicTools } from '../toolCallingFormatters/anthropicToolFormatter';

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 4096;

/** AnthropicAdapter - Messages API with real tool-calling (tools + tool_use content blocks). */
export class AnthropicAdapter extends BaseLLMAdapter {
  readonly name = 'anthropic';
  private apiKey: string;
  private readonly baseURL = 'https://api.anthropic.com/v1';

  constructor(apiKey?: string, model = 'claude-3-5-sonnet-20241022', timeout?: number) {
    super(model, { envVar: 'ANTHROPIC_TIMEOUT', timeout });
    this.apiKey = apiKey || process.env.ANTHROPIC_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('ANTHROPIC_API_KEY not set. Add it to your .env file.\nGet a key at https://console.anthropic.com/settings/keys');
    }
  }

  async complete(messages: Message[], tools: Tool[] = []): Promise<LLMResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: DEFAULT_MAX_TOKENS,
      messages: messages.map(m => ({ role: m.role, content: m.content }))
    };
    if (tools.length > 0) {
      body.tools = toAnthropicTools(tools);
    }

    try {
      const response = await axios.post(`${this.baseURL}/messages`, body, {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION
        },
        timeout: this.timeout
      });

      const toolCalls = ToolCallingParser.parseFunctionCalls(response.data, 'anthropic');
      const blocks: Array<Record<string, unknown>> = response.data?.content ?? [];
      const content = blocks
        .filter(block => block.type === 'text')
        .map(block => block.text as string)
        .join('');

      const usage = response.data?.usage ?? {};
      this.trackUsage((usage.input_tokens ?? 0) + (usage.output_tokens ?? 0));
      return { content, toolCalls };
    } catch (error) {
      console.error('Anthropic API error:', (error as Error).message);
      throw error;
    }
  }
}
