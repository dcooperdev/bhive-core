import { Bee } from '../../src/bee/Bee';
import { BeeConfig } from '../../src/bee/BeeConfig';
import { MockLLM } from '../__mocks__/MockLLM';
import { mockClassifyTool } from '../fixtures/tools';
import { Tool } from '../../src/types';

describe('Bee', () => {
  let bee: Bee;
  let beeConfig: BeeConfig;
  let mockLLM: MockLLM;

  beforeEach(() => {
    beeConfig = new BeeConfig();
    mockLLM = new MockLLM();
  });

  describe('constructor', () => {
    it('should initialize with auto-detected config', () => {
      bee = new Bee(
        'classifier',
        'You classify emails',
        [mockClassifyTool],
        mockLLM as any,
        beeConfig,
        'gemini-1.5-flash'
      );

      expect(bee.getName()).toBe('classifier');
      const config = bee.getConfig();
      expect(config.requestsPerMinute).toBe(60);
      expect(config.recommendedDelayMs).toBe(1000);
    });

    it('should use conservative defaults for unknown model', () => {
      bee = new Bee(
        'analyzer',
        'You analyze data',
        [],
        mockLLM as any,
        beeConfig,
        'unknown-model'
      );

      const config = bee.getConfig();
      expect(config.requestsPerMinute).toBe(10);
      expect(config.recommendedDelayMs).toBe(5000);
    });
  });

  describe('run', () => {
    beforeEach(() => {
      bee = new Bee(
        'test-bee',
        'You respond to input',
        [],
        mockLLM as any,
        beeConfig,
        'gemini-1.5-flash'
      );
    });

    it('should execute input and return output', async () => {
      const result = await bee.run('Test input');

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('should track runs', async () => {
      await bee.run('Test 1');
      await bee.run('Test 2');

      const runs = bee.getRuns();
      expect(runs).toHaveLength(2);
      expect(runs[0].input).toBe('Test 1');
      expect(runs[1].input).toBe('Test 2');
    });

    it('should respect rate limiting delay', async () => {
      const startTime = Date.now();
      await bee.run('Test 1');
      await bee.run('Test 2');
      const elapsed = Date.now() - startTime;

      // Should have applied delay between requests
      // Exact timing may vary, but should be at least close to delay
      expect(elapsed).toBeGreaterThan(100); // Allow some margin
    });
  });

  describe('updateConfig', () => {
    beforeEach(() => {
      bee = new Bee(
        'test-bee',
        'Test',
        [],
        mockLLM as any,
        beeConfig,
        'gemini-1.5-flash'
      );
    });

    it('should update config after plan change', () => {
      const oldConfig = bee.getConfig();
      expect(oldConfig.requestsPerMinute).toBe(60);

      const newConfig = beeConfig.getModelLimits('gemini-1.5-pro');
      bee.updateConfig(newConfig);

      const updatedConfig = bee.getConfig();
      expect(updatedConfig.requestsPerMinute).toBe(120);
      expect(updatedConfig.recommendedDelayMs).toBe(500);
    });
  });

  describe('getInfo', () => {
    beforeEach(() => {
      bee = new Bee(
        'test-bee',
        'Test',
        [],
        mockLLM as any,
        beeConfig,
        'gemini-1.5-flash'
      );
    });

    it('should return bee info', async () => {
      await bee.run('Test');
      const info = bee.getInfo();

      expect(info.name).toBe('test-bee');
      expect(info.model).toBe('Gemini 1.5 Flash');
      expect(info.delayMs).toBe(1000);
      expect(info.rateLimitPerMin).toBe(60);
      expect(info.runs).toBe(1);
    });
  });

  describe('error handling', () => {
    it('should back off and retry on a 503 error', async () => {
      // Keep the test fast: near-zero delay/backoff instead of the real 1000ms.
      beeConfig.updateModelLimits('gemini-1.5-flash', {
        ...beeConfig.getModelLimits('gemini-1.5-flash'),
        recommendedDelayMs: 5
      });

      bee = new Bee('retry-bee', 'Test', [], mockLLM as any, beeConfig, 'gemini-1.5-flash');

      const error = Object.assign(new Error('Service Unavailable'), {
        response: { status: 503 }
      });
      mockLLM.failNext(error);

      const result = await bee.run('Test input');

      expect(result).not.toMatch(/^Error:/);
      expect(mockLLM.getCallCount()).toBe(2); // first call fails, retry succeeds
    });

    it('should return a graceful error string on timeout', async () => {
      beeConfig.updateModelLimits('gemini-1.5-flash', {
        ...beeConfig.getModelLimits('gemini-1.5-flash'),
        recommendedDelayMs: 5,
        timeout: 50
      });

      bee = new Bee('timeout-bee', 'Test', [], mockLLM as any, beeConfig, 'gemini-1.5-flash');
      mockLLM.hangNextCall();

      const result = await bee.run('Test input');

      expect(result).toMatch(/Timeout after 50ms/);
    });

    it('should fail gracefully on a non-503, non-timeout error', async () => {
      beeConfig.updateModelLimits('gemini-1.5-flash', {
        ...beeConfig.getModelLimits('gemini-1.5-flash'),
        recommendedDelayMs: 5
      });

      bee = new Bee('failing-bee', 'Test', [], mockLLM as any, beeConfig, 'gemini-1.5-flash');
      mockLLM.failNext(new Error('boom'));

      const result = await bee.run('Test input');

      expect(result).toBe('Error: boom');
    });
  });

  describe('tool calling', () => {
    it('should execute a matched tool, skip an unknown one, and log a failing one', async () => {
      const failingTool: Tool = {
        name: 'failing_tool',
        description: 'Always throws',
        execute: async () => {
          throw new Error('tool exploded');
        }
      };

      bee = new Bee(
        'tool-bee',
        'Use your tools',
        [mockClassifyTool, failingTool],
        mockLLM as any,
        beeConfig,
        'gemini-1.5-flash'
      );

      mockLLM.respondOnceWith({
        content: 'Calling tools',
        toolCalls: [
          { name: 'classify_email', params: { from: 'boss@company.com', subject: 'Hi' } },
          { name: 'unknown_tool', params: {} },
          { name: 'failing_tool', params: {} }
        ]
      });

      const result = await bee.run('Test input');

      // Second iteration gets the default mock response, since the tool
      // result message that seeded it happens to contain "classify".
      expect(result).toBe(JSON.stringify({ classification: 'NORMAL', priority: 'medium' }));

      const run = bee.getRuns()[0];
      expect(run.toolCalls).toHaveLength(1);
      expect(run.toolCalls[0].toolName).toBe('classify_email');
    });
  });
});
