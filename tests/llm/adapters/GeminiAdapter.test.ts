import axios from 'axios';
import { GeminiAdapter } from '../../../src/llm/adapters/GeminiAdapter';
import { Tool } from '../../../src/types';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const fetchTool: Tool = {
  name: 'fetch_repo',
  description: 'Fetches a repo',
  parameters: { type: 'object', properties: { repo: { type: 'string' } }, required: ['repo'] },
  execute: async () => 'ok'
};

describe('GeminiAdapter', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws if no API key is available', () => {
    const original = process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    expect(() => new GeminiAdapter(undefined, 'gemini-1.5-flash')).toThrow(/GOOGLE_API_KEY/);
    if (original) process.env.GOOGLE_API_KEY = original;
  });

  it('sends functionDeclarations built from the given tools', async () => {
    mockedAxios.post.mockResolvedValue({ data: { candidates: [{ content: { parts: [{ text: 'hi' }] } }] } });
    const adapter = new GeminiAdapter('test-key', 'gemini-1.5-flash');

    await adapter.complete([{ role: 'user', content: 'go' }], [fetchTool]);

    const [, body] = mockedAxios.post.mock.calls[0];
    expect((body as any).tools[0].functionDeclarations[0]).toMatchObject({
      name: 'fetch_repo',
      parameters: { type: 'OBJECT', required: ['repo'] }
    });
  });

  it('omits `tools` from the request body when no tools are given', async () => {
    mockedAxios.post.mockResolvedValue({ data: { candidates: [{ content: { parts: [{ text: 'hi' }] } }] } });
    const adapter = new GeminiAdapter('test-key');

    await adapter.complete([{ role: 'user', content: 'go' }]);

    const [, body] = mockedAxios.post.mock.calls[0];
    expect(body).not.toHaveProperty('tools');
  });

  it('parses a functionCall response into toolCalls and empty content', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        candidates: [{ content: { parts: [{ functionCall: { name: 'fetch_repo', args: { repo: 'a/b' } } }] } }],
        usageMetadata: { totalTokenCount: 42 }
      }
    });
    const adapter = new GeminiAdapter('test-key');

    const result = await adapter.complete([{ role: 'user', content: 'go' }], [fetchTool]);

    expect(result.toolCalls).toEqual([{ id: 'gemini-0-fetch_repo', name: 'fetch_repo', args: { repo: 'a/b' } }]);
    expect(result.content).toBe('');
    expect(adapter.getTokens()).toBe(42);
    expect(adapter.getCallCount()).toBe(1);
  });

  it('parses a plain text response with no tool calls', async () => {
    mockedAxios.post.mockResolvedValue({ data: { candidates: [{ content: { parts: [{ text: 'Hello there' }] } }] } });
    const adapter = new GeminiAdapter('test-key');

    const result = await adapter.complete([{ role: 'user', content: 'go' }]);

    expect(result.content).toBe('Hello there');
    expect(result.toolCalls).toEqual([]);
  });

  it('rethrows the original axios error so 503 retry logic can inspect it', async () => {
    const error = Object.assign(new Error('Service Unavailable'), { response: { status: 503 } });
    mockedAxios.post.mockRejectedValue(error);
    const adapter = new GeminiAdapter('test-key');

    await expect(adapter.complete([{ role: 'user', content: 'go' }])).rejects.toBe(error);
  });
});
