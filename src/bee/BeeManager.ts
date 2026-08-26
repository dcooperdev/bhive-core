import { randomUUID } from 'crypto';
import { Tool, QueueConfig, BeeEvent, DelegationRequest, TrustLevel } from '../types';
import { LLMAdapter } from '../providers/LLMAdapter';
import { StorageProvider } from '../providers/StorageProvider';
import { ContextProvider } from '../providers/ContextProvider';
import { EventPublisher } from '../providers/EventBus';
import { GeminiAdapter } from '../adapters/GeminiAdapter';
import { BeeConfig } from './BeeConfig';
import { Bee } from './Bee';

export interface BeeManagerOptions {
  /** Used to construct the default GeminiAdapter when no llmAdapter is given. */
  apiKey?: string;
  llmAdapter?: LLMAdapter;
  storageProvider?: StorageProvider;
  contextProvider?: ContextProvider;
  eventPublisher?: EventPublisher;
}

export interface BeeDefinition {
  name: string;
  prompt: string;
  tools: Tool[];
  model?: string;
  maxIterations?: number;
  /** Per-Bee overrides. Default to the BeeManager-level providers when omitted. */
  llmAdapter?: LLMAdapter;
  storageProvider?: StorageProvider;
  contextProvider?: ContextProvider;
  eventPublisher?: EventPublisher;
  queueConfig?: QueueConfig;
  /** How freely this Bee may delegate to other agents. Defaults to 'open'. */
  trustLevel?: TrustLevel;
  /** Required when trustLevel is 'careful': the only agent names this Bee may delegate to. */
  allowedDelegates?: string[];
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
 * Initializes BeeConfig + a default LLMAdapter on startup, creates
 * auto-configured Bees, coordinates multi-Bee task execution, and
 * reconfigures every Bee in memory when the underlying model/plan
 * changes. Every provider (LLM, storage, context, events) is injected -
 * BeeManager never depends on a concrete backend.
 */
export class BeeManager {
  private beeConfig: BeeConfig;
  private llm: LLMAdapter;
  private defaultModel: string;
  private bees: Map<string, Bee> = new Map();

  private storageProvider?: StorageProvider;
  private contextProvider?: ContextProvider;
  private eventPublisher?: EventPublisher;

  private delegationHistory: DelegationRequest[] = [];

  constructor(defaultModel: string, options: BeeManagerOptions = {}) {
    this.defaultModel = defaultModel;
    this.beeConfig = new BeeConfig();
    this.llm = options.llmAdapter || new GeminiAdapter(options.apiKey, defaultModel);
    this.storageProvider = options.storageProvider;
    this.contextProvider = options.contextProvider;
    this.eventPublisher = options.eventPublisher;

    const limits = this.beeConfig.getModelLimits(defaultModel);

    console.log('🐝 BeeManager initialized');
    console.log(`   Model: ${defaultModel} (LLM adapter: ${this.llm.name})`);
    console.log(`   Rate limit: ${limits.requestsPerMinute} req/min`);
    console.log(`   Delay: ${limits.recommendedDelayMs}ms\n`);
  }

  /**
   * Creates a new auto-configured Bee. Any provider omitted from the
   * definition falls back to the BeeManager's own provider, if any.
   */
  createBee(definition: BeeDefinition): Bee {
    const model = definition.model || this.defaultModel;
    const llm = definition.llmAdapter || this.llm;

    const bee = new Bee(
      definition.name,
      definition.prompt,
      definition.tools,
      llm,
      this.beeConfig,
      model,
      {
        maxIterations: definition.maxIterations ?? 3,
        storageProvider: definition.storageProvider || this.storageProvider,
        contextProvider: definition.contextProvider || this.contextProvider,
        eventPublisher: definition.eventPublisher || this.eventPublisher,
        queueConfig: definition.queueConfig,
        beeManager: this,
        trustLevel: definition.trustLevel,
        allowedDelegates: definition.allowedDelegates
      }
    );

    this.bees.set(definition.name, bee);

    return bee;
  }

  getBee(name: string): Bee | undefined {
    return this.bees.get(name);
  }

  /** Names of every Bee registered with this BeeManager. */
  getRegisteredAgents(): string[] {
    return Array.from(this.bees.keys());
  }

  /**
   * Delegates a task from one registered Bee to another and resolves
   * with the target's output. Used internally by Bee.delegateTo() (and
   * by delegation tools created via createDelegationTool), but can also
   * be called directly.
   */
  async delegateToAgent(
    fromBeeName: string,
    toBeeName: string,
    task: string,
    chain: string[] = [fromBeeName]
  ): Promise<string> {
    const request: DelegationRequest = { from: fromBeeName, to: toBeeName, task, timestamp: new Date() };
    this.delegationHistory.push(request);

    const targetBee = this.bees.get(toBeeName);

    if (!targetBee) {
      const error = new Error(`Delegation failed: agent "${toBeeName}" is not registered with this BeeManager`);
      await this.emitDelegationEvent('delegation:error', request, { error: error.message });
      throw error;
    }

    if (chain.includes(toBeeName)) {
      const error = new Error(`Circular delegation detected: ${[...chain, toBeeName].join(' -> ')}`);
      await this.emitDelegationEvent('delegation:error', request, { error: error.message });
      throw error;
    }

    await this.emitDelegationEvent('delegation:start', request);

    try {
      const result = await targetBee.run(task, [...chain, toBeeName]);
      await this.emitDelegationEvent('delegation:complete', request, { result });
      return result;
    } catch (error) {
      await this.emitDelegationEvent('delegation:error', request, { error: (error as Error).message });
      throw error;
    }
  }

  /** Every delegation attempted through this BeeManager, oldest first. */
  getDelegationHistory(): DelegationRequest[] {
    return [...this.delegationHistory];
  }

  private async emitDelegationEvent(
    type: 'delegation:start' | 'delegation:complete' | 'delegation:error',
    request: DelegationRequest,
    extra: Record<string, unknown> = {}
  ): Promise<void> {
    if (!this.eventPublisher) return;

    const event: BeeEvent = {
      id: randomUUID(),
      timestamp: new Date(),
      beeName: request.from,
      type,
      data: { from: request.from, to: request.to, task: request.task, ...extra }
    };

    try {
      await this.eventPublisher.publish(event);
    } catch (error) {
      console.error(`   ⚠️  Failed to publish event "${type}": ${(error as Error).message}`);
    }
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

  getLLM(): LLMAdapter {
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
