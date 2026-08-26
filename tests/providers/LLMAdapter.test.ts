jest.mock('axios');

import axios from 'axios';
import { LLMAdapter } from '../../src/providers/LLMAdapter';
import { GeminiAdapter } from '../../src/adapters/GeminiAdapter';
import { MockLLM } from '../__mocks__/MockLLM';

const mockedAxios = axios as jest.Mocked<typeof axios>;

beforeEach(() => {
  mockedAxios.post.mockResolvedValue({
    data: {
      candidates: [{ content: { parts: [{ text: 'ok' }] } }],
      usageMetadata: { totalTokenCount: 5 }
    }
  });
});

/**
 * Contract test: any LLMAdapter implementation must satisfy this shared
 * behavior regardless of which backend it wraps.
 */
function describeLLMAdapterContract(adapterName: string, factory: () => LLMAdapter) {
  describe(`LLMAdapter contract: ${adapterName}`, () => {
    let adapter: LLMAdapter;

    beforeEach(() => {
      adapter = factory();
    });

    it('should expose a non-empty backend name', () => {
      expect(typeof adapter.name).toBe('string');
      expect(adapter.name.length).toBeGreaterThan(0);
    });

    it('should start with zero tokens and zero calls', () => {
      expect(adapter.getTokens()).toBe(0);
      expect(adapter.getCallCount()).toBe(0);
    });

    it('should reset stats back to zero', () => {
      adapter.resetStats();
      expect(adapter.getTokens()).toBe(0);
      expect(adapter.getCallCount()).toBe(0);
    });

    it('should round-trip the model via setModel/getModel', () => {
      adapter.setModel('some-other-model');
      expect(adapter.getModel()).toBe('some-other-model');
    });

    it('should expose a complete() method returning a promise', async () => {
      const result = adapter.complete([{ role: 'user', content: 'Hi' }]);
      expect(result).toBeInstanceOf(Promise);
      await result;
    });
  });
}

describeLLMAdapterContract('GeminiAdapter', () => new GeminiAdapter('test-key'));
describeLLMAdapterContract('MockLLM', () => new MockLLM());
