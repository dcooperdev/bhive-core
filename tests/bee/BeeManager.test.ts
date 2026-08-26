jest.mock('axios');

import axios from 'axios';
import { BeeManager, BeeDefinition } from '../../src/bee/BeeManager';
import { mockClassifyTool } from '../fixtures/tools';

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

    beeManager = new BeeManager('gemini-1.5-flash', 'test-api-key');
  });

  describe('constructor', () => {
    it('should initialize with model', () => {
      expect(beeManager).toBeDefined();
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
});
