export interface ModelLimits {
  name: string;
  requestsPerMinute: number;
  recommendedDelayMs: number;
  maxTokensPerRequest: number;
  maxTokensPerMinute: number;
  timeout: number;
  estimatedCostPer1kTokens: { input: number; output: number };
  recommendedBatchSize: number;
  /** Model is still registered for backward compatibility but retired from the provider's API. */
  deprecated?: boolean;
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

    // --- Google Gemini: current/active models (as of Aug 2026) ---

    this.registry.set('gemini-flash-2.0', {
      name: 'Gemini Flash 2.0',
      requestsPerMinute: 1000,
      recommendedDelayMs: 100,
      maxTokensPerRequest: 8000,
      maxTokensPerMinute: 4000000,
      timeout: 30000,
      estimatedCostPer1kTokens: { input: 0, output: 0 },
      recommendedBatchSize: 10
    });

    this.registry.set('gemini-flash-lite-latest', {
      name: 'Gemini Flash Lite (latest)',
      requestsPerMinute: 600,
      recommendedDelayMs: 200,
      maxTokensPerRequest: 4000,
      maxTokensPerMinute: 2000000,
      timeout: 30000,
      estimatedCostPer1kTokens: { input: 0, output: 0 },
      recommendedBatchSize: 8
    });

    this.registry.set('gemini-3.6-flash', {
      name: 'Gemini 3.6 Flash',
      requestsPerMinute: 300,
      recommendedDelayMs: 300,
      maxTokensPerRequest: 6000,
      maxTokensPerMinute: 2000000,
      timeout: 30000,
      estimatedCostPer1kTokens: { input: 0, output: 0 },
      recommendedBatchSize: 6
    });

    this.registry.set('gemini-2.0-pro', {
      name: 'Gemini 2.0 Pro',
      requestsPerMinute: 100,
      recommendedDelayMs: 1000,
      maxTokensPerRequest: 10000,
      maxTokensPerMinute: 2000000,
      timeout: 60000,
      estimatedCostPer1kTokens: { input: 0.00125, output: 0.005 },
      recommendedBatchSize: 5
    });

    // --- Google Gemini: legacy models (retired from the API, kept for
    //     backward compatibility - calls will 404 against Google). ---

    this.registry.set('gemini-1.5-flash', {
      name: 'Gemini 1.5 Flash',
      requestsPerMinute: 60,
      recommendedDelayMs: 1000,
      maxTokensPerRequest: 8000,
      maxTokensPerMinute: 1000000,
      timeout: 30000,
      estimatedCostPer1kTokens: { input: 0.00015, output: 0.0006 },
      recommendedBatchSize: 5,
      deprecated: true
    });

    this.registry.set('gemini-1.5-pro', {
      name: 'Gemini 1.5 Pro',
      requestsPerMinute: 120,
      recommendedDelayMs: 500,
      maxTokensPerRequest: 16000,
      maxTokensPerMinute: 2000000,
      timeout: 60000,
      estimatedCostPer1kTokens: { input: 0.00125, output: 0.005 },
      recommendedBatchSize: 10,
      deprecated: true
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

    this.registry.set('gpt-4o', {
      name: 'GPT-4o',
      requestsPerMinute: 500,
      recommendedDelayMs: 100,
      maxTokensPerRequest: 16000,
      maxTokensPerMinute: 8000000,
      timeout: 30000,
      estimatedCostPer1kTokens: { input: 0.0025, output: 0.01 },
      recommendedBatchSize: 10
    });

    this.registry.set('gpt-4-turbo', {
      name: 'GPT-4 Turbo',
      requestsPerMinute: 300,
      recommendedDelayMs: 200,
      maxTokensPerRequest: 4096,
      maxTokensPerMinute: 4000000,
      timeout: 60000,
      estimatedCostPer1kTokens: { input: 0.01, output: 0.03 },
      recommendedBatchSize: 8
    });

    // --- Anthropic ---

    this.registry.set('claude-3-5-sonnet-20241022', {
      name: 'Claude 3.5 Sonnet',
      requestsPerMinute: 1000,
      recommendedDelayMs: 100,
      maxTokensPerRequest: 8000,
      maxTokensPerMinute: 4000000,
      timeout: 30000,
      estimatedCostPer1kTokens: { input: 0.003, output: 0.015 },
      recommendedBatchSize: 10
    });

    this.registry.set('claude-3-opus-20250219', {
      name: 'Claude 3 Opus',
      requestsPerMinute: 100,
      recommendedDelayMs: 1000,
      maxTokensPerRequest: 8000,
      maxTokensPerMinute: 2000000,
      timeout: 60000,
      estimatedCostPer1kTokens: { input: 0.015, output: 0.075 },
      recommendedBatchSize: 5
    });

    this.registry.set('claude-3-haiku-20250307', {
      name: 'Claude 3 Haiku',
      requestsPerMinute: 3000,
      recommendedDelayMs: 50,
      maxTokensPerRequest: 4096,
      maxTokensPerMinute: 10000000,
      timeout: 30000,
      estimatedCostPer1kTokens: { input: 0.00025, output: 0.00125 },
      recommendedBatchSize: 15
    });

    // --- Ollama (local): no API cost, limits bounded by local hardware ---

    for (const localModel of ['llama3.1', 'mistral-nemo', 'qwen2.5', 'mistral']) {
      this.registry.set(localModel, {
        name: `Ollama ${localModel}`,
        requestsPerMinute: 100,
        recommendedDelayMs: 500,
        maxTokensPerRequest: 8000,
        maxTokensPerMinute: 800000,
        timeout: 60000,
        estimatedCostPer1kTokens: { input: 0, output: 0 },
        recommendedBatchSize: 2
      });
    }
  }

  /**
   * Returns auto-detected limits for a model.
   *
   * A registered-but-deprecated model still returns its real limits, with a
   * one-line warning pointing at the current replacement. An unregistered
   * model falls back to conservative defaults silently - it may be a custom
   * model or a newer provider variant that simply isn't in the registry yet,
   * and the conservative defaults are a safe choice either way.
   */
  getModelLimits(modelName: string): ModelLimits {
    const limits = this.registry.get(modelName);

    if (!limits) {
      return { ...DEFAULT_LIMITS };
    }

    if (limits.deprecated) {
      console.warn(
        `   ⚠️  Model "${modelName}" is deprecated and may be retired from the provider API. ` +
          `See docs/LLM_PROVIDERS.md for current models.`
      );
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
