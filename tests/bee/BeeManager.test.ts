jest.mock('axios');

import axios from 'axios';
import { BeeManager, BeeDefinition } from '../../src/bee/BeeManager';
import { mockClassifyTool } from '../fixtures/tools';
import { MockLLM } from '../__mocks__/MockLLM';
import { InMemoryStorage } from '../../src/storage/InMemoryStorage';
import { RecordingEventPublisher } from '../fixtures/providers';

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('BeeManager', () => {
  let beeManager: BeeManager;

  beforeEach(() => {
    mockedAxios.post.mockResolvedValue({
      data: {
        candidates: [{ content: { parts: [{ text: 'Mocked LLM response' }] } }],
        usageMetadata: { totalTokenCount: 42 }
      }
    });

    beeManager = new BeeManager('gemini-1.5-flash', { apiKey: 'test-api-key' });
  });

  describe('constructor', () => {
    it('should initialize with model', () => {
      expect(beeManager).toBeDefined();
    });

    it('should default to a GeminiAdapter when no options are given at all', () => {
      const manager = new BeeManager('gemini-1.5-flash');
      expect(manager.getLLM().name).toBe('gemini');
    });
  });

  describe('timeout configuration', () => {
    const TIMEOUT_ENV = ['BEE_TIMEOUT', 'GEMINI_TIMEOUT'];
    afterEach(() => TIMEOUT_ENV.forEach(k => delete process.env[k]));

    it('defaults the auto-built adapter to 60s', () => {
      const manager = new BeeManager({ llmProvider: 'gemini', apiKey: 'k' });
      expect(manager.getLLM().timeout).toBe(60_000);
    });

    it('passes the `timeout` option to both the adapter and every Bee', () => {
      const manager = new BeeManager({ llmProvider: 'gemini', apiKey: 'k', timeout: 90_000 });
      expect(manager.getLLM().timeout).toBe(90_000);

      manager.createBee({ name: 'b', prompt: 'p', tools: [] });
      expect(manager.getBee('b')!.getConfig().timeout).toBe(90_000);
    });

    it('falls back to the BEE_TIMEOUT env var', () => {
      process.env.BEE_TIMEOUT = '120000';
      const manager = new BeeManager({ llmProvider: 'gemini', apiKey: 'k' });
      expect(manager.getLLM().timeout).toBe(120_000);

      manager.createBee({ name: 'b', prompt: 'p', tools: [] });
      expect(manager.getBee('b')!.getConfig().timeout).toBe(120_000);
    });

    it('leaves a pre-built llmAdapter untouched', () => {
      const mockLLM = new MockLLM();
      const manager = new BeeManager({ llmAdapter: mockLLM, timeout: 90_000 });
      expect(manager.getLLM()).toBe(mockLLM);
    });
  });

  describe('createBee', () => {
    it('should create and register bee', () => {
      const def: BeeDefinition = {
        name: 'classifier',
        prompt: 'Classify emails',
        tools: [mockClassifyTool]
      };

      const bee = beeManager.createBee(def);

      expect(bee).toBeDefined();
      expect(bee.getName()).toBe('classifier');
      expect(beeManager.getBee('classifier')).toBe(bee);
    });

    it('should create multiple bees', () => {
      beeManager.createBee({
        name: 'classifier',
        prompt: 'Classify',
        tools: []
      });

      beeManager.createBee({
        name: 'responder',
        prompt: 'Respond',
        tools: []
      });

      expect(beeManager.getBee('classifier')).toBeDefined();
      expect(beeManager.getBee('responder')).toBeDefined();
    });
  });

  describe('executeTask', () => {
    beforeEach(() => {
      beeManager.createBee({
        name: 'bee1',
        prompt: 'Task 1',
        tools: []
      });

      beeManager.createBee({
        name: 'bee2',
        prompt: 'Task 2',
        tools: []
      });
    });

    it('should execute task with single bee', async () => {
      const result = await beeManager.executeTask('Test task', ['bee1']);

      expect(result).toBeDefined();
      expect(result['bee1']).toBeDefined();
    });

    it('should execute task with multiple bees', async () => {
      const result = await beeManager.executeTask(
        'Process email',
        ['bee1', 'bee2']
      );

      expect(result['bee1']).toBeDefined();
      expect(result['bee2']).toBeDefined();
    });

    it('should handle missing bee gracefully', async () => {
      const result = await beeManager.executeTask('Test', ['nonexistent']);

      // Should not throw, just skip missing bee
      expect(result).toBeDefined();
      expect(result['nonexistent']).toBeUndefined();
    });
  });

  describe('restart', () => {
    beforeEach(() => {
      beeManager.createBee({
        name: 'classifier',
        prompt: 'Classify',
        tools: []
      });
    });

    it('should reconfigure bees on restart', () => {
      const bee = beeManager.getBee('classifier');
      const oldConfig = bee?.getConfig();

      beeManager.restart('gemini-1.5-pro');

      const newConfig = bee?.getConfig();
      expect(newConfig?.requestsPerMinute).toBe(120);
      expect(newConfig?.requestsPerMinute).not.toBe(
        oldConfig?.requestsPerMinute
      );
    });

    it('should update rate limits in memory', () => {
      const bee = beeManager.getBee('classifier');

      beeManager.restart('mixtral-8x7b-32768');

      const config = bee?.getConfig();
      expect(config?.requestsPerMinute).toBe(300);
      expect(config?.recommendedDelayMs).toBe(200);
    });
  });

  describe('getBeeStats', () => {
    beforeEach(() => {
      beeManager.createBee({
        name: 'bee1',
        prompt: 'Test',
        tools: []
      });

      beeManager.createBee({
        name: 'bee2',
        prompt: 'Test',
        tools: []
      });
    });

    it('should return stats for all bees', () => {
      const stats = beeManager.getBeeStats();

      expect(stats['bee1']).toBeDefined();
      expect(stats['bee2']).toBeDefined();
      expect(stats['bee1'].name).toBe('bee1');
      expect(stats['bee2'].name).toBe('bee2');
    });
  });

  describe('printSummary', () => {
    it('should not throw when printing a summary with no runs yet', () => {
      expect(() => beeManager.printSummary()).not.toThrow();
    });

    it('should not throw when printing a summary after runs', async () => {
      beeManager.createBee({ name: 'bee1', prompt: 'Test', tools: [] });
      await beeManager.executeTask('Test', ['bee1']);

      expect(() => beeManager.printSummary()).not.toThrow();
    });
  });

  describe('updateModelLimits', () => {
    it('should store new limits in BeeConfig for a model', () => {
      beeManager.updateModelLimits('gemini-1.5-flash', {
        name: 'Gemini 1.5 Flash',
        requestsPerMinute: 999,
        recommendedDelayMs: 1000,
        maxTokensPerRequest: 8000,
        maxTokensPerMinute: 1000000,
        timeout: 30000,
        estimatedCostPer1kTokens: { input: 0.00015, output: 0.0006 },
        recommendedBatchSize: 5
      });

      beeManager.createBee({ name: 'classifier', prompt: 'Classify', tools: [] });

      expect(beeManager.getBee('classifier')?.getConfig().requestsPerMinute).toBe(999);
    });
  });

  describe('getLLM', () => {
    it('should return the underlying LLM instance', () => {
      expect(beeManager.getLLM()).toBeDefined();
      expect(beeManager.getLLM().getTokens()).toBe(0);
    });
  });

  describe('providers', () => {
    it('should use an injected llmAdapter instead of the default GeminiAdapter', () => {
      const mockLLM = new MockLLM();
      const manager = new BeeManager('gemini-1.5-flash', { llmAdapter: mockLLM });

      expect(manager.getLLM()).toBe(mockLLM);
      expect(manager.getLLM().name).toBe('mock');
    });

    it('should pass manager-level providers down to every created bee', async () => {
      const mockLLM = new MockLLM();
      const storage = new InMemoryStorage();
      const events = new RecordingEventPublisher();

      const manager = new BeeManager('gemini-1.5-flash', {
        llmAdapter: mockLLM,
        storageProvider: storage,
        eventPublisher: events
      });

      manager.createBee({
        name: 'classifier',
        prompt: 'Classify',
        tools: [],
        queueConfig: { persist: true, persistenceKey: 'shared:classifier-queue' }
      });

      await manager.executeTask('Test', ['classifier']);

      expect(events.eventsOfType('run:complete')).toHaveLength(1);
      expect(await storage.listLength('shared:classifier-queue')).toBe(0);
    });

    it('should let a per-bee provider override the manager-level default', () => {
      const managerLLM = new MockLLM();
      const beeLLM = new MockLLM();
      const manager = new BeeManager('gemini-1.5-flash', { llmAdapter: managerLLM });

      manager.createBee({
        name: 'classifier',
        prompt: 'Classify',
        tools: [],
        llmAdapter: beeLLM
      });

      // The manager's own default LLM is unaffected by the per-bee override.
      expect(manager.getLLM()).toBe(managerLLM);
    });
  });
});
