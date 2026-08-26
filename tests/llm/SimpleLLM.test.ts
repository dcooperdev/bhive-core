jest.mock('axios');

import axios from 'axios';
import { SimpleLLM } from '../../src/llm/SimpleLLM';

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('SimpleLLM', () => {
  it('should require API key', () => {
    // Save original env
    const original = process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_API_KEY;

    expect(() => {
      new SimpleLLM();
    }).toThrow('GOOGLE_API_KEY not set');

    // Restore
    process.env.GOOGLE_API_KEY = original;
  });

  it('should accept API key in constructor', () => {
    const llm = new SimpleLLM('test-key');
    expect(llm).toBeDefined();
  });

  it('should track token count', () => {
    const llm = new SimpleLLM('test-key');
    expect(llm.getTokens()).toBe(0);
    expect(llm.getCallCount()).toBe(0);
  });

  it('should reset stats', () => {
    const llm = new SimpleLLM('test-key');
    llm.resetStats();

    expect(llm.getTokens()).toBe(0);
    expect(llm.getCallCount()).toBe(0);
  });

  it('should allow the model to be changed after construction', () => {
    const llm = new SimpleLLM('test-key', 'gemini-1.5-flash');
    llm.setModel('gemini-1.5-pro');
    expect(llm.getModel()).toBe('gemini-1.5-pro');
  });

  // Note: Actual API calls should be tested with real API or mocked HTTP
  describe('complete', () => {
    beforeEach(() => {
      mockedAxios.post.mockReset();
    });

    it('should return content and track tokens on success', async () => {
      mockedAxios.post.mockResolvedValue({
        data: {
          candidates: [{ content: { parts: [{ text: 'Hello there' }] } }],
          usageMetadata: { totalTokenCount: 25 }
        }
      });

      const llm = new SimpleLLM('test-key');
      const result = await llm.complete([{ role: 'user', content: 'Hi' }]);

      expect(result.content).toBe('Hello there');
      expect(llm.getTokens()).toBe(25);
      expect(llm.getCallCount()).toBe(1);
    });

    it('should accumulate tokens across multiple calls', async () => {
      mockedAxios.post.mockResolvedValue({
        data: {
          candidates: [{ content: { parts: [{ text: 'ok' }] } }],
          usageMetadata: { totalTokenCount: 10 }
        }
      });

      const llm = new SimpleLLM('test-key');
      await llm.complete([{ role: 'user', content: 'Hi' }]);
      await llm.complete([{ role: 'user', content: 'Hi again' }]);

      expect(llm.getTokens()).toBe(20);
      expect(llm.getCallCount()).toBe(2);
    });

    it('should default missing usageMetadata to 0 tokens', async () => {
      mockedAxios.post.mockResolvedValue({
        data: {
          candidates: [{ content: { parts: [{ text: 'ok' }] } }]
        }
      });

      const llm = new SimpleLLM('test-key');
      await llm.complete([{ role: 'user', content: 'Hi' }]);

      expect(llm.getTokens()).toBe(0);
    });

    it('should map non-user roles to the Gemini "model" role', async () => {
      mockedAxios.post.mockResolvedValue({
        data: {
          candidates: [{ content: { parts: [{ text: 'ok' }] } }],
          usageMetadata: { totalTokenCount: 5 }
        }
      });

      const llm = new SimpleLLM('test-key');
      await llm.complete([
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello back' }
      ]);

      const [, body] = mockedAxios.post.mock.calls[0];
      expect((body as any).contents[1].role).toBe('model');
    });

    it('should log and rethrow on API failure', async () => {
      mockedAxios.post.mockRejectedValue(new Error('Request failed with status code 503'));

      const llm = new SimpleLLM('test-key');

      await expect(
        llm.complete([{ role: 'user', content: 'Hi' }])
      ).rejects.toThrow('Request failed with status code 503');

      expect(llm.getCallCount()).toBe(1);
    });
  });
});
