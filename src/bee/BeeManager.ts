import { SimpleLLM } from '../llm';
import { Tool } from '../types';
import { BeeConfig } from './BeeConfig';
import { Bee } from './Bee';

export interface BeeDefinition {
  name: string;
  prompt: string;
  tools: Tool[];
  model?: string;
  maxIterations?: number;
}

export interface BeeStats {
  name: string;
  model: string;
  delayMs: number;
  rateLimitPerMin: number;
  runs: number;
}

/**
 * BeeManager - Global Orchestrator
 *
 * Initializes BeeConfig + the LLM on startup, creates auto-configured
 * Bees, coordinates multi-Bee task execution, and reconfigures every
 * Bee in memory when the underlying model/plan changes.
 */
export class BeeManager {
  private beeConfig: BeeConfig;
  private llm: SimpleLLM;
  private defaultModel: string;
  private bees: Map<string, Bee> = new Map();

  constructor(defaultModel: string, apiKey?: string) {
    this.defaultModel = defaultModel;
    this.beeConfig = new BeeConfig();
    this.llm = new SimpleLLM(apiKey, defaultModel);

    const limits = this.beeConfig.getModelLimits(defaultModel);

    console.log('🐝 BeeManager initialized');
    console.log(`   Model: ${defaultModel}`);
    console.log(`   Rate limit: ${limits.requestsPerMinute} req/min`);
    console.log(`   Delay: ${limits.recommendedDelayMs}ms\n`);
  }

  /**
   * Creates a new auto-configured Bee. If no model is given, the
   * BeeManager's default model is used.
   */
  createBee(definition: BeeDefinition): Bee {
    const model = definition.model || this.defaultModel;

    const bee = new Bee(
      definition.name,
      definition.prompt,
      definition.tools,
      this.llm,
      this.beeConfig,
      model,
      definition.maxIterations ?? 3
    );

    this.bees.set(definition.name, bee);

    return bee;
  }

  getBee(name: string): Bee | undefined {
    return this.bees.get(name);
  }

  /**
   * Runs a task across the named Bees, in sequence, and collects each
   * Bee's output.
   */
  async executeTask(
    taskDescription: string,
    beeNames: string[]
  ): Promise<Record<string, string>> {
    console.log(`\n🐝 Hive Task: ${taskDescription}`);
    console.log(`   Bees: ${beeNames.join(', ')}`);
    console.log('   ═══════════════════════════════════');

    const results: Record<string, string> = {};

    for (const beeName of beeNames) {
      const bee = this.bees.get(beeName);

      if (!bee) {
        console.log(`⚠️  Bee not found: ${beeName}`);
        continue;
      }

      results[beeName] = await bee.run(taskDescription);
    }

    return results;
  }

  /**
   * Updates a model's limits in memory (e.g. after a plan upgrade).
   * Call restart() to push the new limits out to all Bees.
   */
  updateModelLimits(modelName: string, newLimits: Parameters<BeeConfig['updateModelLimits']>[1]): void {
    this.beeConfig.updateModelLimits(modelName, newLimits);
  }

  /**
   * Reconfigures every existing Bee in memory against the given model
   * (or the current default model). No Bees are recreated - each just
   * reloads its limits from BeeConfig.
   */
  restart(model?: string): void {
    if (model) {
      this.defaultModel = model;
    }

    console.log(`\n🔄 BeeManager restarting with model: ${this.defaultModel}`);

    this.llm.setModel(this.defaultModel);

    for (const bee of this.bees.values()) {
      const limits = this.beeConfig.getModelLimits(this.defaultModel);
      bee.updateConfig(limits);
    }

    console.log('✅ All Bees reconfigured\n');
  }

  /**
   * Returns each Bee's current config and run count, keyed by name.
   */
  getBeeStats(): Record<string, BeeStats> {
    const stats: Record<string, BeeStats> = {};

    for (const [name, bee] of this.bees.entries()) {
      stats[name] = bee.getInfo();
    }

    return stats;
  }

  /**
   * Prints each Bee's config, rate limits, and number of runs, plus
   * overall LLM token/cost stats.
   */
  printSummary(): void {
    console.log('\n═══════════════════════════════════════');
    console.log('📊 HIVE SUMMARY\n');

    for (const stats of Object.values(this.getBeeStats())) {
      console.log(`🐝 ${stats.name}`);
      console.log(`   Model: ${stats.model}`);
      console.log(`   Rate limit: ${stats.rateLimitPerMin} req/min`);
      console.log(`   Delay: ${stats.delayMs}ms`);
      console.log(`   Runs: ${stats.runs}`);
    }

    const totalTokens = this.llm.getTokens();
    const totalCalls = this.llm.getCallCount();

    console.log(`\nTotal Tokens Used: ${totalTokens}`);
    console.log(`Total LLM Calls: ${totalCalls}`);
    if (totalCalls > 0) {
      console.log(`Avg Tokens per Call: ${Math.round(totalTokens / totalCalls)}`);
    }
    console.log(`Estimated Cost: $${this.estimateCost(totalTokens)}`);
    console.log('═══════════════════════════════════════\n');
  }

  getLLM(): SimpleLLM {
    return this.llm;
  }

  private estimateCost(tokens: number): string {
    const { input, output } = this.beeConfig.getModelLimits(this.defaultModel).estimatedCostPer1kTokens;

    const inputTokens = tokens * 0.7;
    const outputTokens = tokens * 0.3;

    const inputCost = (inputTokens / 1000) * input;
    const outputCost = (outputTokens / 1000) * output;

    return (inputCost + outputCost).toFixed(6);
  }
}
