import axios from 'axios';
import { OpenAIAdapter } from '../../../src/llm/adapters/OpenAIAdapter';
import { Tool } from '../../../src/types';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const fetchTool: Tool = { name: 'fetch_repo', description: 'Fetches a repo', execute: async () => 'ok' };
const analyzeTool: Tool = { name: 'analyze_code', description: 'Analyzes code', execute: async () => 'ok' };

describe('OpenAIAdapter', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws if no API key is available', () => {
    const original = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    expect(() => new OpenAIAdapter(undefined, 'gpt-4o-mini')).toThrow(/OPENAI_API_KEY/);
    if (original) process.env.OPENAI_API_KEY = original;
  });

  it('sends tools in the OpenAI function-calling shape with tool_choice auto', async () => {
    mockedAxios.post.mockResolvedValue({ data: { choices: [{ message: { content: 'hi' } }] } });
    const adapter = new OpenAIAdapter('test-key');

    await adapter.complete([{ role: 'user', content: 'go' }], [fetchTool]);

    const [, body] = mockedAxios.post.mock.calls[0];
    expect((body as any).tools[0]).toMatchObject({ type: 'function', function: { name: 'fetch_repo' } });
    expect((body as any).tool_choice).toBe('auto');
  });

  it('sends the Authorization bearer header', async () => {
    mockedAxios.post.mockResolvedValue({ data: { choices: [{ message: { content: 'hi' } }] } });
    const adapter = new OpenAIAdapter('secret-key');

    await adapter.complete([{ role: 'user', content: 'go' }]);

    const [, , config] = mockedAxios.post.mock.calls[0];
    expect((config as any).headers.Authorization).toBe('Bearer secret-key');
  });

  it('parses a single tool_calls response', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        choices: [{ message: { tool_calls: [{ id: 'call_1', function: { name: 'fetch_repo', arguments: '{"repo":"a/b"}' } }] } }],
        usage: { total_tokens: 10 }
      }
    });
    const adapter = new OpenAIAdapter('test-key');

    const result = await adapter.complete([{ role: 'user', content: 'go' }], [fetchTool]);

    expect(result.toolCalls).toEqual([{ id: 'call_1', name: 'fetch_repo', args: { repo: 'a/b' } }]);
    expect(adapter.getTokens()).toBe(10);
  });

  it('parses multiple tool_calls in one response', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        choices: [
          {
            message: {
              tool_calls: [
                { id: 'call_1', function: { name: 'fetch_repo', arguments: '{"repo":"a/b"}' } },
                { id: 'call_2', function: { name: 'analyze_code', arguments: '{}' } }
              ]
            }
          }
        ]
      }
    });
    const adapter = new OpenAIAdapter('test-key');

    const result = await adapter.complete([{ role: 'user', content: 'go' }], [fetchTool, analyzeTool]);

    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls.map(c => c.name)).toEqual(['fetch_repo', 'analyze_code']);
  });

  it('returns plain content when the model replies with no tool calls', async () => {
    mockedAxios.post.mockResolvedValue({ data: { choices: [{ message: { content: 'All done.' } }] } });
    const adapter = new OpenAIAdapter('test-key');

    const result = await adapter.complete([{ role: 'user', content: 'go' }]);

    expect(result.content).toBe('All done.');
    expect(result.toolCalls).toEqual([]);
  });

  it('rethrows the original axios error', async () => {
    const error = Object.assign(new Error('rate limited'), { response: { status: 429 } });
    mockedAxios.post.mockRejectedValue(error);
    const adapter = new OpenAIAdapter('test-key');

    await expect(adapter.complete([{ role: 'user', content: 'go' }])).rejects.toBe(error);
  });
});
