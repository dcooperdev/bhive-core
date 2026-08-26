export interface ModelLimits {
  name: string;
  requestsPerMinute: number;
  recommendedDelayMs: number;
  maxTokensPerRequest: number;
  maxTokensPerMinute: number;
  timeout: number;
  estimatedCostPer1kTokens: { input: number; output: number };
  recommendedBatchSize: number;
}

const DEFAULT_LIMITS: ModelLimits = {
  name: 'Unknown Model',
  requestsPerMinute: 10,
  recommendedDelayMs: 5000,
  maxTokensPerRequest: 2048,
  maxTokensPerMinute: 100000,
  timeout: 30000,
  estimatedCostPer1kTokens: { input: 0, output: 0 },
  recommendedBatchSize: 1
};

/**
 * BeeConfig - Auto-Detection Engine
 *
 * Maintains a registry of known models with their rate limits, delays,
 * timeouts and token limits. BeeManager/Bee call getModelLimits() on
 * init so no manual rate-limit configuration is ever required.
 */
export class BeeConfig {
  private registry: Map<string, ModelLimits>;

  constructor() {
    this.registry = new Map();

    this.registry.set('gemini-1.5-flash', {
      name: 'Gemini 1.5 Flash',
      requestsPerMinute: 60,
      recommendedDelayMs: 1000,
      maxTokensPerRequest: 8000,
      maxTokensPerMinute: 1000000,
      timeout: 30000,
      estimatedCostPer1kTokens: { input: 0.00015, output: 0.0006 },
      recommendedBatchSize: 5
    });

    this.registry.set('gemini-1.5-pro', {
      name: 'Gemini 1.5 Pro',
      requestsPerMinute: 120,
      recommendedDelayMs: 500,
      maxTokensPerRequest: 16000,
      maxTokensPerMinute: 2000000,
      timeout: 60000,
      estimatedCostPer1kTokens: { input: 0.00125, output: 0.005 },
      recommendedBatchSize: 10
    });

    this.registry.set('mixtral-8x7b-32768', {
      name: 'Groq Mixtral 8x7b',
      requestsPerMinute: 300,
      recommendedDelayMs: 200,
      maxTokensPerRequest: 32000,
      maxTokensPerMinute: 6000000,
      timeout: 20000,
      estimatedCostPer1kTokens: { input: 0, output: 0 },
      recommendedBatchSize: 20
    });

    this.registry.set('gpt-4o-mini', {
      name: 'GPT-4o Mini',
      requestsPerMinute: 500,
      recommendedDelayMs: 100,
      maxTokensPerRequest: 16000,
      maxTokensPerMinute: 10000000,
      timeout: 30000,
      estimatedCostPer1kTokens: { input: 0.00015, output: 0.0006 },
      recommendedBatchSize: 15
    });
  }

  /**
   * Returns auto-detected limits for a model.
   * Falls back to conservative defaults for unknown models.
   */
  getModelLimits(modelName: string): ModelLimits {
    const limits = this.registry.get(modelName);

    if (!limits) {
      console.log(
        `   ⚠️  Unknown model "${modelName}", using conservative defaults`
      );
      return { ...DEFAULT_LIMITS };
    }

    return { ...limits };
  }

  /**
   * Stores new limits in memory (e.g. after a plan upgrade).
   * Call beeManager.restart() afterwards to apply them to all Bees.
   */
  updateModelLimits(modelName: string, newLimits: ModelLimits): void {
    this.registry.set(modelName, { ...newLimits });
    console.log(`   ✅ Updated limits for ${modelName}:`, this.registry.get(modelName));
  }

  /**
   * Returns the list of model names with known, registered limits.
   */
  getRegisteredModels(): string[] {
    return Array.from(this.registry.keys());
  }
}
