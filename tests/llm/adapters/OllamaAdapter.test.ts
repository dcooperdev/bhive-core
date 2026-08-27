import axios from 'axios';
import { OllamaAdapter } from '../../../src/llm/adapters/OllamaAdapter';
import { Tool } from '../../../src/types';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const fetchTool: Tool = { name: 'fetch_repo', description: 'Fetches a repo', execute: async () => 'ok' };

describe('OllamaAdapter', () => {
  beforeEach(() => jest.clearAllMocks());

  it('needs no API key - only a base URL, defaulting to localhost:11434', async () => {
    mockedAxios.post.mockResolvedValue({ data: { message: { content: 'hi' } } });
    const adapter = new OllamaAdapter('llama3.1');

    await adapter.complete([{ role: 'user', content: 'go' }]);

    const [url] = mockedAxios.post.mock.calls[0];
    expect(url).toBe('http://localhost:11434/api/chat');
  });

  it('respects a custom base URL (e.g. OLLAMA_BASE_URL)', async () => {
    mockedAxios.post.mockResolvedValue({ data: { message: { content: 'hi' } } });
    const adapter = new OllamaAdapter('llama3.1', 'http://my-ollama-host:11434');

    await adapter.complete([{ role: 'user', content: 'go' }]);

    const [url] = mockedAxios.post.mock.calls[0];
    expect(url).toBe('http://my-ollama-host:11434/api/chat');
  });

  it('sends OpenAI-shaped tools when tools are given', async () => {
    mockedAxios.post.mockResolvedValue({ data: { message: { content: 'hi' } } });
    const adapter = new OllamaAdapter('llama3.1');

    await adapter.complete([{ role: 'user', content: 'go' }], [fetchTool]);

    const [, body] = mockedAxios.post.mock.calls[0];
    expect((body as any).tools[0]).toMatchObject({ type: 'function', function: { name: 'fetch_repo' } });
  });

  it('parses tool_calls when the local model supports them', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { message: { tool_calls: [{ function: { name: 'fetch_repo', arguments: { repo: 'a/b' } } }] } }
    });
    const adapter = new OllamaAdapter('llama3.1');

    const result = await adapter.complete([{ role: 'user', content: 'go' }], [fetchTool]);

    expect(result.toolCalls).toEqual([{ id: 'ollama-0', name: 'fetch_repo', args: { repo: 'a/b' } }]);
  });

  it('degrades to plain content with no tool calls for a model that ignores `tools`', async () => {
    mockedAxios.post.mockResolvedValue({ data: { message: { content: "Sure, here's an answer." } } });
    const adapter = new OllamaAdapter('llama3.1');

    const result = await adapter.complete([{ role: 'user', content: 'go' }], [fetchTool]);

    expect(result.content).toBe("Sure, here's an answer.");
    expect(result.toolCalls).toEqual([]);
  });

  it('raises a clear "is it running?" error when the connection is refused', async () => {
    const error = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), { isAxiosError: true, response: undefined });
    mockedAxios.post.mockRejectedValue(error);
    mockedAxios.isAxiosError.mockReturnValue(true);
    const adapter = new OllamaAdapter('llama3.1');

    await expect(adapter.complete([{ role: 'user', content: 'go' }])).rejects.toThrow(/is it running/);
  });
});
