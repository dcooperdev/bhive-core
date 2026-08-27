import axios from 'axios';
import { AnthropicAdapter } from '../../../src/llm/adapters/AnthropicAdapter';
import { Tool } from '../../../src/types';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const fetchTool: Tool = {
  name: 'fetch_repo',
  description: 'Fetches a repo',
  parameters: { type: 'object', properties: { repo: { type: 'string' } }, required: ['repo'] },
  execute: async () => 'ok'
};

describe('AnthropicAdapter', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws if no API key is available', () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => new AnthropicAdapter(undefined)).toThrow(/ANTHROPIC_API_KEY/);
    if (original) process.env.ANTHROPIC_API_KEY = original;
  });

  it('sends tools using input_schema and the required auth headers', async () => {
    mockedAxios.post.mockResolvedValue({ data: { type: 'message', content: [{ type: 'text', text: 'hi' }] } });
    const adapter = new AnthropicAdapter('test-key', 'claude-3-5-sonnet-20241022');

    await adapter.complete([{ role: 'user', content: 'go' }], [fetchTool]);

    const [, body, config] = mockedAxios.post.mock.calls[0];
    expect((body as any).tools[0]).toMatchObject({ name: 'fetch_repo', input_schema: { type: 'object' } });
    expect((config as any).headers['x-api-key']).toBe('test-key');
    expect((config as any).headers['anthropic-version']).toBe('2023-06-01');
  });

  it('parses a tool_use content block into a toolCall', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        type: 'message',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'fetch_repo', input: { repo: 'a/b' } }],
        usage: { input_tokens: 5, output_tokens: 7 }
      }
    });
    const adapter = new AnthropicAdapter('test-key');

    const result = await adapter.complete([{ role: 'user', content: 'go' }], [fetchTool]);

    expect(result.toolCalls).toEqual([{ id: 'toolu_1', name: 'fetch_repo', args: { repo: 'a/b' } }]);
    expect(result.content).toBe('');
    expect(adapter.getTokens()).toBe(12);
  });

  it('concatenates text blocks and ignores tool_use blocks in `content`', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        type: 'message',
        content: [
          { type: 'text', text: 'Part one. ' },
          { type: 'tool_use', id: 'toolu_1', name: 'fetch_repo', input: {} },
          { type: 'text', text: 'Part two.' }
        ]
      }
    });
    const adapter = new AnthropicAdapter('test-key');

    const result = await adapter.complete([{ role: 'user', content: 'go' }]);

    expect(result.content).toBe('Part one. Part two.');
  });

  it('rethrows the original axios error', async () => {
    const error = Object.assign(new Error('overloaded'), { response: { status: 529 } });
    mockedAxios.post.mockRejectedValue(error);
    const adapter = new AnthropicAdapter('test-key');

    await expect(adapter.complete([{ role: 'user', content: 'go' }])).rejects.toBe(error);
  });
});
