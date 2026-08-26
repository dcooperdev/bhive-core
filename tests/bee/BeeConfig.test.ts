import { BeeConfig, ModelLimits } from '../../src/bee/BeeConfig';

describe('BeeConfig', () => {
  let beeConfig: BeeConfig;

  beforeEach(() => {
    beeConfig = new BeeConfig();
  });

  describe('getModelLimits', () => {
    it('should return limits for known model: gemini-1.5-flash', () => {
      const limits = beeConfig.getModelLimits('gemini-1.5-flash');

      expect(limits).toBeDefined();
      expect(limits.name).toBe('Gemini 1.5 Flash');
      expect(limits.requestsPerMinute).toBe(60);
      expect(limits.recommendedDelayMs).toBe(1000);
      expect(limits.maxTokensPerRequest).toBe(8000);
      expect(limits.timeout).toBe(30000);
    });

    it('should return limits for gemini-1.5-pro', () => {
      const limits = beeConfig.getModelLimits('gemini-1.5-pro');

      expect(limits.requestsPerMinute).toBe(120);
      expect(limits.recommendedDelayMs).toBe(500);
      expect(limits.maxTokensPerRequest).toBe(16000);
    });

    it('should return limits for groq-mixtral', () => {
      const limits = beeConfig.getModelLimits('mixtral-8x7b-32768');

      expect(limits.requestsPerMinute).toBe(300);
      expect(limits.recommendedDelayMs).toBe(200);
    });

    it('should return conservative defaults for unknown model', () => {
      const limits = beeConfig.getModelLimits('unknown-model-xyz');

      expect(limits.name).toBe('Unknown Model');
      expect(limits.requestsPerMinute).toBe(10);
      expect(limits.recommendedDelayMs).toBe(5000);
      expect(limits.maxTokensPerRequest).toBe(2048);
    });

    it('should have cost estimates for free-tier models', () => {
      const gemini = beeConfig.getModelLimits('gemini-1.5-flash');
      const groq = beeConfig.getModelLimits('mixtral-8x7b-32768');

      expect(gemini.estimatedCostPer1kTokens.input).toBeGreaterThan(0);
      expect(groq.estimatedCostPer1kTokens.input).toBe(0); // Groq free
    });

    it('should return a copy, not a live reference to the registry', () => {
      const limits = beeConfig.getModelLimits('gemini-1.5-flash');
      limits.requestsPerMinute = 999999;

      expect(beeConfig.getModelLimits('gemini-1.5-flash').requestsPerMinute).toBe(60);
    });
  });

  describe('updateModelLimits', () => {
    it('should update limits for existing model', () => {
      const newLimits: ModelLimits = {
        name: 'Updated Model',
        maxTokensPerRequest: 10000,
        maxTokensPerMinute: 100000,
        requestsPerMinute: 200,
        estimatedCostPer1kTokens: { input: 0.5, output: 1 },
        recommendedBatchSize: 5,
        recommendedDelayMs: 300,
        timeout: 25000
      };

      beeConfig.updateModelLimits('gemini-1.5-flash', newLimits);
      const updated = beeConfig.getModelLimits('gemini-1.5-flash');

      expect(updated.name).toBe('Updated Model');
      expect(updated.requestsPerMinute).toBe(200);
      expect(updated.recommendedDelayMs).toBe(300);
    });

    it('should register limits for a brand new model', () => {
      const newLimits: ModelLimits = {
        name: 'Brand New Model',
        maxTokensPerRequest: 4000,
        maxTokensPerMinute: 400000,
        requestsPerMinute: 42,
        estimatedCostPer1kTokens: { input: 0.1, output: 0.2 },
        recommendedBatchSize: 2,
        recommendedDelayMs: 1500,
        timeout: 15000
      };

      beeConfig.updateModelLimits('brand-new-model', newLimits);

      expect(beeConfig.getRegisteredModels()).toContain('brand-new-model');
      expect(beeConfig.getModelLimits('brand-new-model').requestsPerMinute).toBe(42);
    });
  });

  describe('getRegisteredModels', () => {
    it('should return list of all registered models', () => {
      const models = beeConfig.getRegisteredModels();

      expect(models).toContain('gemini-1.5-flash');
      expect(models).toContain('gemini-1.5-pro');
      expect(models).toContain('mixtral-8x7b-32768');
      expect(models).toContain('gpt-4o-mini');
    });
  });
});
