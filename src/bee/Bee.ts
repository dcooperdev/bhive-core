import { randomUUID } from 'crypto';
import {
  Message,
  Tool,
  ToolCall,
  AgentRun,
  BeeEvent,
  BeeEventType,
  QueueConfig,
  ToolExecutionContext,
  TrustLevel,
  BeeIdentity
} from '../types';
import { LLMAdapter } from '../providers/LLMAdapter';
import { StorageProvider } from '../providers/StorageProvider';
import { ContextProvider } from '../providers/ContextProvider';
import { EventPublisher } from '../providers/EventBus';
import { BeeConfig, ModelLimits } from './BeeConfig';
import { BeeSecurityContext } from './BeeSecurityContext';
import { BeeIdentityManager } from './BeeIdentityManager';
import { PromptInjectionDetector } from '../security/PromptInjectionDetector';
import { ToolCallValidator } from '../security/ToolCallValidator';
import { AuditLog } from '../security/AuditLog';
import type { BeeManager } from './BeeManager';

export interface BeeProviderOptions {
  maxIterations?: number;
  storageProvider?: StorageProvider;
  eventPublisher?: EventPublisher;
  contextProvider?: ContextProvider;
  queueConfig?: QueueConfig;
  /** Set by BeeManager.createBee() so the Bee can discover/delegate to its siblings. */
  beeManager?: BeeManager;
  /** How freely this Bee may delegate to other agents. Defaults to 'open'. Ignored when `securityContext` is given. */
  trustLevel?: TrustLevel;
  /** Required when trustLevel is 'careful': the only agent names this Bee may delegate to. Ignored when `securityContext` is given. */
  allowedDelegates?: string[];
  /** Full security policy (whitelist, rate limits, tool restrictions, trust level, isolation). Overrides trustLevel/allowedDelegates when given. */
  securityContext?: BeeSecurityContext;
  /** Shared identity registry. Set by BeeManager.createBee() so Bees can verify/encrypt to each other; defaults to a private instance otherwise. */
  identityManager?: BeeIdentityManager;
  /** Set by BeeManager.createBee() so injection detections are recorded centrally too. */
  auditLog?: AuditLog;
}

interface QueueItem {
  id: string;
  input: string;
  enqueuedAt: number;
  delegationChain: string[];
}

const MAX_CONTEXT_MESSAGES = 20;

/**
 * Bee - Intelligent Individual Agent
 *
 * Auto-configures its rate limit, delay, timeout and max tokens from
 * BeeConfig on construction. Depends only on the LLMAdapter/
 * StorageProvider/ContextProvider/EventPublisher interfaces, never on a
 * concrete backend - callers plug in whichever implementation they want.
 *
 * Every tool call an LLMAdapter reports is run through ToolCallValidator -
 * which checks the tool actually exists on this Bee, is on its allowlist
 * (if any), and that its arguments aren't an injection/prototype-pollution/
 * oversized payload - before `tool.execute()` is ever called. A rejected
 * or failing tool call is reported back into the conversation instead of
 * silently vanishing, so the model can react to it on its next turn.
 */
export class Bee {
  private name: string;
  private prompt: string;
  private tools: Tool[];
  private llm: LLMAdapter;
  private beeConfig: BeeConfig;
  private modelName: string;
  private maxIterations: number;

  private storageProvider?: StorageProvider;
  private eventPublisher?: EventPublisher;
  private contextProvider?: ContextProvider;
  private queueConfig: QueueConfig;

  private beeManager?: BeeManager;
  private securityContext: BeeSecurityContext;
  private identityManager: BeeIdentityManager;
  private identity: BeeIdentity;
  private auditLog?: AuditLog;
  private injectionDetector = new PromptInjectionDetector();
  private toolCallValidator = new ToolCallValidator();

  private config: ModelLimits;
  private lastRequestTime = 0;
  private requestQueue: Promise<void> = Promise.resolve();
  private localQueue: QueueItem[] = [];

  public runs: AgentRun[] = [];

  constructor(
    name: string,
    prompt: string,
    tools: Tool[],
    llm: LLMAdapter,
    beeConfig: BeeConfig,
    modelName: string,
    options: BeeProviderOptions = {}
  ) {
    this.name = name;
    this.prompt = prompt;
    this.tools = tools;
    this.llm = llm;
    this.beeConfig = beeConfig;
    this.modelName = modelName;
    this.maxIterations = options.maxIterations ?? 3;
    this.storageProvider = options.storageProvider;
    this.eventPublisher = options.eventPublisher;
    this.contextProvider = options.contextProvider;
    this.queueConfig = options.queueConfig ?? {};
    this.beeManager = options.beeManager;
    this.securityContext =
      options.securityContext ??
      new BeeSecurityContext({
        trustLevel: options.trustLevel ?? 'open',
        allowedDelegates: options.allowedDelegates ?? []
      });
    this.identityManager = options.identityManager ?? new BeeIdentityManager();
    this.identity = this.identityManager.registerBeeIdentity(this);
    this.auditLog = options.auditLog;

    if (this.queueConfig.persist && !this.storageProvider) {
      console.log(
        `   ⚠️  Bee "${name}" requested a persistent queue but no storageProvider was given; falling back to in-memory.`
      );
    }

    this.config = this.beeConfig.getModelLimits(this.modelName);

    console.log(`🐝 Bee "${this.name}" initialized`);
    console.log(`   Rate limit: ${this.config.requestsPerMinute} req/min`);
    console.log(`   Delay: ${this.config.recommendedDelayMs}ms`);
  }

  /**
   * Reconfigures this Bee in memory, e.g. after a plan change.
   * Called by BeeManager.restart().
   */
  updateConfig(newLimits: ModelLimits): void {
    this.config = newLimits;
    console.log(`   🔄 Bee "${this.name}" reconfigured`);
    console.log(`      Rate limit: ${this.config.requestsPerMinute} req/min`);
    console.log(`      Delay: ${this.config.recommendedDelayMs}ms`);
  }

  getName(): string {
    return this.name;
  }

  getConfig(): ModelLimits {
    return { ...this.config };
  }

  getRuns(): AgentRun[] {
    return this.runs;
  }

  getInfo(): {
    name: string;
    model: string;
    delayMs: number;
    rateLimitPerMin: number;
    runs: number;
  } {
    return {
      name: this.name,
      model: this.config.name,
      delayMs: this.config.recommendedDelayMs,
      rateLimitPerMin: this.config.requestsPerMinute,
      runs: this.runs.length
    };
  }

  /** Number of items currently waiting in the queue (persisted or local). */
  async getQueueLength(): Promise<number> {
    return this.currentQueueLength();
  }

  /** Names of every other agent registered with this Bee's BeeManager, if any. */
  getAvailableAgents(): string[] {
    if (!this.beeManager) return [];
    return this.beeManager.getRegisteredAgents().filter(name => name !== this.name);
  }

  /** This Bee's RSA identity (public key openly shareable, private key never leaves the identityManager). */
  getIdentity(): BeeIdentity {
    return this.identity;
  }

  /** This Bee's security policy (delegation whitelist, rate limits, tool restrictions, trust level). */
  getSecurityContext(): BeeSecurityContext {
    return this.securityContext;
  }

  /**
   * Delegates a task to another agent registered with the same
   * BeeManager, and resolves with that agent's output. Requires this
   * Bee to have been created via BeeManager.createBee().
   */
  async delegateTo(agentName: string, task: string, chain: string[] = [this.name]): Promise<string> {
    if (!this.beeManager) {
      throw new Error(
        `Bee "${this.name}" cannot delegate: it was not created via BeeManager.createBee()`
      );
    }

    if (!this.securityContext.isAllowedDelegate(agentName)) {
      await this.emitEvent('security:unauthorized_delegation', { agentName, trustLevel: this.securityContext.trustLevel });
      await this.auditLog?.record({
        beeName: this.name,
        type: 'unauthorized_delegation',
        detail: `Blocked delegation to "${agentName}" (trustLevel "${this.securityContext.trustLevel}")`
      });

      const message =
        this.securityContext.trustLevel === 'strict'
          ? `Bee "${this.name}" has trustLevel "strict" and cannot delegate to other agents`
          : `Bee "${this.name}" (trustLevel "careful") is not allowed to delegate to "${agentName}"`;

      throw new Error(message);
    }

    return this.beeManager.delegateToAgent(this.name, agentName, task, chain);
  }

  /**
   * Enqueues a task behind any pending work on this Bee, then processes
   * it once its turn comes, respecting rate limiting. The queue is
   * storage-backed (shared, multi-instance-safe capacity accounting)
   * when `queueConfig.persist` and a storageProvider are both set,
   * otherwise it's a plain in-memory array.
   */
  async run(input: string, delegationChain: string[] = [this.name]): Promise<string> {
    const item: QueueItem = { id: randomUUID(), input, enqueuedAt: Date.now(), delegationChain };

    const queueLength = await this.currentQueueLength();
    if (this.queueConfig.maxSize !== undefined && queueLength >= this.queueConfig.maxSize) {
      await this.emitEvent('queue:full', { queueLength, maxSize: this.queueConfig.maxSize });
      throw new Error(`Queue full: "${this.name}" has reached its max size of ${this.queueConfig.maxSize}`);
    }

    await this.enqueueItem(item);
    await this.emitEvent('run:enqueued', { id: item.id, input });

    const task = this.requestQueue.then(() => this.dequeueAndProcess(item));
    // dequeueAndProcess never rejects (it catches its own errors), so the
    // queue only ever needs to wait on it, never swallow a rejection.
    this.requestQueue = task.then(() => undefined);
    return task;
  }

  private async dequeueAndProcess(item: QueueItem): Promise<string> {
    // Pop the front of the shared/local queue for bookkeeping. Under
    // concurrent multi-instance access against the same storage key this
    // is best-effort visibility, not a distributed lock: the promise this
    // call resolves with always corresponds to `item`, the input this
    // very run() call received.
    await this.dequeueItem();

    const waitedMs = Date.now() - item.enqueuedAt;
    if (this.queueConfig.ttl !== undefined && waitedMs > this.queueConfig.ttl) {
      await this.emitEvent('queue:expired', { id: item.id, waitedMs });

      const output = `Error: Task expired in queue after ${this.queueConfig.ttl}ms`;
      this.runs.push({
        agent: this.name,
        input: item.input,
        toolCalls: [],
        output,
        tokensUsed: 0,
        timestamp: new Date()
      });

      return output;
    }

    return this.executeWithRateLimit(item.input, item.delegationChain);
  }

  private async executeWithRateLimit(input: string, delegationChain: string[]): Promise<string> {
    await this.applyDelay();

    const safePrompt = this.injectionDetector.detectInjection(input);
    if (safePrompt.patterns.length > 0) {
      await this.emitEvent('security:injection_detected', {
        injectionRisk: safePrompt.injectionRisk,
        patterns: safePrompt.patterns
      });
      await this.auditLog?.record({
        beeName: this.name,
        type: 'injection_detected',
        detail: `risk=${safePrompt.injectionRisk.toFixed(2)}`,
        metadata: { patterns: safePrompt.patterns }
      });
    }

    await this.emitEvent('run:start', { input });

    console.log(`\n[${this.name}] Running...`);
    console.log(`   Input: ${input}`);

    const history = await this.loadContext();
    const messages: Message[] = [
      ...history,
      // The LLM only ever sees the sanitized text; `input`/AgentRun.input
      // still record what was actually requested, for audit purposes.
      { role: 'user', content: `${this.prompt}\n\nTask: ${safePrompt.sanitized}` }
    ];

    const toolContext: ToolExecutionContext = {
      beeName: this.name,
      delegate: (agentName, task) => this.delegateTo(agentName, task, delegationChain)
    };

    const toolCalls: ToolCall[] = [];
    let output = '';
    let iterations = 0;
    let failed = false;

    while (iterations < this.maxIterations) {
      iterations++;
      console.log(`   [Iteration ${iterations}/${this.maxIterations}]`);

      try {
        const response = await this.callWithRetry(messages);

        messages.push({ role: 'assistant', content: response.content });
        output = response.content;

        if (!response.toolCalls || response.toolCalls.length === 0) {
          console.log('   ✅ Bee finished (no more tool calls)');
          break;
        }

        for (const rawCall of response.toolCalls) {
          const validation = this.toolCallValidator.validate(rawCall, this.tools, this.name, this.securityContext.allowedTools);

          if (!validation.valid) {
            console.log(`   🚫 Rejected tool call "${rawCall?.name}": ${validation.reason}`);
            await this.emitEvent('security:invalid_tool_call', { toolName: rawCall?.name, reason: validation.reason });
            await this.auditLog?.record({ beeName: this.name, type: 'invalid_tool_call', detail: validation.reason });
            messages.push({ role: 'user', content: `Tool call rejected: ${validation.reason}` });
            continue;
          }

          const { toolName, args } = validation.call;
          // Guaranteed present: ToolCallValidator only returns valid:true for a name found in this.tools.
          const tool = this.tools.find(t => t.name === toolName)!;

          try {
            const result = await tool.execute(args, toolContext);

            console.log(`   → ${tool.name}(${JSON.stringify(args).substring(0, 40)})`);
            console.log(`   ← ${result.substring(0, 60)}`);

            toolCalls.push({ toolName: tool.name, params: args, result });

            messages.push({
              role: 'user',
              content: `Tool ${tool.name} returned: ${result}`
            });
          } catch (error) {
            const message = (error as Error).message;
            console.error(`   ❌ Tool execution error: ${message}`);
            messages.push({ role: 'user', content: `Tool ${tool.name} failed: ${message}` });
          }
        }
      } catch (error) {
        console.error(`   ❌ Bee error: ${(error as Error).message}`);
        output = `Error: ${(error as Error).message}`;
        failed = true;
        break;
      }
    }

    await this.saveContext(messages);

    const run: AgentRun = {
      agent: this.name,
      input,
      toolCalls,
      output,
      tokensUsed: this.llm.getTokens(),
      timestamp: new Date()
    };

    this.runs.push(run);

    await this.emitEvent(failed ? 'run:error' : 'run:complete', { input, output });

    return output;
  }

  /**
   * Waits out any remaining delay since the last request before firing
   * the next one, per the auto-configured recommendedDelayMs.
   */
  private async applyDelay(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestTime;
    const remaining = this.config.recommendedDelayMs - elapsed;

    if (remaining > 0) {
      await sleep(remaining);
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Calls the LLM with the Bee's timeout, retrying with exponential
   * backoff on 503 (service unavailable / overloaded) errors.
   */
  private async callWithRetry(
    messages: Message[],
    delayMs: number = this.config.recommendedDelayMs
  ): ReturnType<LLMAdapter['complete']> {
    try {
      return await withTimeout(
        this.llm.complete(messages, this.tools),
        this.config.timeout
      );
    } catch (error) {
      const status = (error as any)?.response?.status;

      if (status === 503) {
        const nextDelay = delayMs * 2;
        console.log(`   ⏳ 503 received, backing off ${nextDelay}ms and retrying...`);
        await this.emitEvent('retry', { reason: '503', nextDelayMs: nextDelay });
        await sleep(nextDelay);
        return this.callWithRetry(messages, nextDelay);
      }

      if ((error as Error).message === 'TIMEOUT') {
        throw new Error(`Timeout after ${this.config.timeout}ms`);
      }

      throw error;
    }
  }

  // --- Queue (storage-backed or in-memory) -------------------------------

  private get queueKey(): string {
    return this.queueConfig.persistenceKey || `bee:${this.name}:queue`;
  }

  private get usesPersistentQueue(): boolean {
    return Boolean(this.queueConfig.persist && this.storageProvider);
  }

  private async currentQueueLength(): Promise<number> {
    if (this.usesPersistentQueue) {
      return this.storageProvider!.listLength(this.queueKey);
    }
    return this.localQueue.length;
  }

  private async enqueueItem(item: QueueItem): Promise<void> {
    if (this.usesPersistentQueue) {
      await this.storageProvider!.pushToList(this.queueKey, item);
    } else {
      this.localQueue.push(item);
    }
  }

  private async dequeueItem(): Promise<void> {
    if (this.usesPersistentQueue) {
      await this.storageProvider!.popFromList(this.queueKey);
    } else {
      this.localQueue.shift();
    }
  }

  // --- Context (conversation memory across runs) --------------------------

  private get contextKey(): string {
    return `bee:${this.name}:context`;
  }

  private async loadContext(): Promise<Message[]> {
    if (!this.contextProvider) return [];
    const saved = await this.contextProvider.getContext<Message[]>(this.contextKey);
    return saved ?? [];
  }

  private async saveContext(messages: Message[]): Promise<void> {
    if (!this.contextProvider) return;
    await this.contextProvider.setContext(this.contextKey, messages.slice(-MAX_CONTEXT_MESSAGES));
  }

  // --- Events --------------------------------------------------------------

  private async emitEvent(type: BeeEventType, data: Record<string, unknown>): Promise<void> {
    if (!this.eventPublisher) return;

    const event: BeeEvent = {
      id: randomUUID(),
      timestamp: new Date(),
      beeName: this.name,
      type,
      data
    };

    try {
      await this.eventPublisher.publish(event);
    } catch (error) {
      console.error(`   ⚠️  Failed to publish event "${type}": ${(error as Error).message}`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('TIMEOUT')), ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
