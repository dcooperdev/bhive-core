import { randomUUID } from 'crypto';
import {
  Tool,
  QueueConfig,
  BeeEvent,
  BeeEventType,
  DelegationRequest,
  TrustLevel,
  SecurityConfig,
  SecureAgentMessage
} from '../types';
import { LLMAdapter } from '../providers/LLMAdapter';
import { StorageProvider } from '../providers/StorageProvider';
import { ContextProvider } from '../providers/ContextProvider';
import { EventPublisher } from '../providers/EventBus';
import { createLLMAdapter, isKnownProvider, LLMProviderName, PROVIDER_REGISTRY } from '../llm/providerRegistry';
import { BeeConfig } from './BeeConfig';
import { Bee } from './Bee';
import { BeeSecurityContext } from './BeeSecurityContext';
import { BeeIdentityManager } from './BeeIdentityManager';
import { PromptInjectionDetector } from '../security/PromptInjectionDetector';
import { MessageSigner } from '../security/MessageSigner';
import { MessageEncryption } from '../security/MessageEncryption';
import { AttestationChainService } from '../security/AttestationChain';
import { AuditLog } from '../security/AuditLog';
import { SecurityError } from '../security/SecureMessage';

export interface BeeManagerOptions {
  /** Used to construct the default provider adapter when no llmAdapter is given. */
  apiKey?: string;
  llmAdapter?: LLMAdapter;
  /** Which built-in adapter to auto-construct when `llmAdapter` isn't given. Defaults to the `LLM_PROVIDER` env var, then 'gemini'. */
  llmProvider?: LLMProviderName;
  /** Model name to use with the auto-constructed adapter. Defaults to that provider's registry default. */
  model?: string;
  storageProvider?: StorageProvider;
  contextProvider?: ContextProvider;
  eventPublisher?: EventPublisher;
  /** Signing/encryption are opt-in; omitting this preserves plain-text v0.3 delegation. */
  securityOptions?: SecurityConfig;
  /** Shared RSA identity registry for every Bee this manager creates. Defaults to a fresh instance. */
  identityManager?: BeeIdentityManager;
  /** Where security-relevant events get recorded. Defaults to an in-memory log (storage-backed when storageProvider is given). */
  auditLog?: AuditLog;
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
  /** How freely this Bee may delegate to other agents. Defaults to 'open'. Ignored when `securityContext` is given. */
  trustLevel?: TrustLevel;
  /** Required when trustLevel is 'careful': the only agent names this Bee may delegate to. Ignored when `securityContext` is given. */
  allowedDelegates?: string[];
  /** Full security policy (whitelist, rate limits, tool restrictions, trust level, isolation). Overrides trustLevel/allowedDelegates when given. */
  securityContext?: BeeSecurityContext;
}

export interface BeeStats {
  name: string;
  model: string;
  delayMs: number;
  rateLimitPerMin: number;
  runs: number;
}

function resolveProvider(explicit?: LLMProviderName): LLMProviderName {
  if (explicit) return explicit;
  const envProvider = process.env.LLM_PROVIDER;
  if (envProvider && isKnownProvider(envProvider)) return envProvider;
  if (envProvider) {
    console.warn(
      `   ⚠️  Unknown LLM_PROVIDER "${envProvider}", falling back to "gemini". Supported: ${Object.keys(PROVIDER_REGISTRY).join(', ')}`
    );
  }
  return 'gemini';
}

/**
 * BeeManager - Global Orchestrator
 *
 * Initializes BeeConfig + a default LLMAdapter on startup, creates
 * auto-configured Bees, coordinates multi-Bee task execution, and
 * reconfigures every Bee in memory when the underlying model/plan
 * changes. Every provider (LLM, storage, context, events) is injected -
 * BeeManager never depends on a concrete backend.
 *
 * Two constructor forms are both supported:
 *   new BeeManager('gemini-1.5-flash', { llmAdapter, eventPublisher, ... })   // legacy positional form
 *   new BeeManager({ llmProvider: 'openai', apiKey, ... })                    // provider-picking form
 *
 * In the second form (or when the first argument is omitted entirely), the
 * model and adapter are both resolved from `llmProvider` - falling back to
 * the `LLM_PROVIDER` env var, then 'gemini' - via src/llm/providerRegistry.ts.
 * See docs/LLM_PROVIDERS.md for the full provider table.
 */
export class BeeManager {
  private beeConfig: BeeConfig;
  private llm: LLMAdapter;
  private defaultModel: string;
  private bees: Map<string, Bee> = new Map();

  private storageProvider?: StorageProvider;
  private contextProvider?: ContextProvider;
  private eventPublisher?: EventPublisher;

  private securityOptions: SecurityConfig;
  private identityManager: BeeIdentityManager;
  private auditLog: AuditLog;
  private injectionDetector = new PromptInjectionDetector();
  private messageSigner = new MessageSigner();
  private messageEncryption = new MessageEncryption();
  private attestationChain: AttestationChainService;

  private delegationHistory: DelegationRequest[] = [];

  constructor(modelOrOptions: string | BeeManagerOptions = {}, maybeOptions: BeeManagerOptions = {}) {
    const options: BeeManagerOptions = typeof modelOrOptions === 'string' ? maybeOptions : modelOrOptions;
    const provider = resolveProvider(options.llmProvider);
    const defaultModel =
      typeof modelOrOptions === 'string' ? modelOrOptions : options.model ?? PROVIDER_REGISTRY[provider].defaultModel;

    this.defaultModel = defaultModel;
    this.beeConfig = new BeeConfig();
    this.llm = options.llmAdapter || createLLMAdapter(provider, options.apiKey, defaultModel);
    this.storageProvider = options.storageProvider;
    this.contextProvider = options.contextProvider;
    this.eventPublisher = options.eventPublisher;

    this.securityOptions = options.securityOptions ?? {};
    this.identityManager = options.identityManager ?? new BeeIdentityManager();
    this.auditLog = options.auditLog ?? new AuditLog(this.storageProvider, `hive:${defaultModel}:audit-log`);
    this.attestationChain = new AttestationChainService(this.storageProvider);

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
        identityManager: this.identityManager,
        auditLog: this.auditLog,
        securityContext:
          definition.securityContext ??
          new BeeSecurityContext({
            trustLevel: definition.trustLevel ?? this.securityOptions.trustLevel ?? 'open',
            allowedDelegates: definition.allowedDelegates
          }),
        storageProvider: definition.storageProvider || this.storageProvider,
        contextProvider: definition.contextProvider || this.contextProvider,
        eventPublisher: definition.eventPublisher || this.eventPublisher,
        queueConfig: definition.queueConfig,
        beeManager: this
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
   *
   * Runs the full secure-delegation pipeline from docs/SECURITY.md:
   * sender security context + rate limit, prompt-injection scanning,
   * optional signing/encryption (opt-in via `securityOptions`),
   * attestation, and - on receive - decrypt/verify/replay/timestamp
   * checks before the target Bee ever sees the task. Every step is
   * recorded to the audit log; security-specific failures publish
   * `delegation:security_error` instead of the generic `delegation:error`.
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
      await this.auditLog.record({ beeName: fromBeeName, type: 'unauthorized_delegation', detail: error.message });
      throw error;
    }

    if (chain.includes(toBeeName)) {
      const error = new Error(`Circular delegation detected: ${[...chain, toBeeName].join(' -> ')}`);
      await this.emitDelegationEvent('delegation:error', request, { error: error.message });
      throw error;
    }

    const senderContext = this.bees.get(fromBeeName)?.getSecurityContext() ?? new BeeSecurityContext();

    if (!senderContext.isAllowedDelegate(toBeeName)) {
      const error = new Error(`Delegation blocked: "${fromBeeName}" is not allowed to delegate to "${toBeeName}"`);
      await this.emitDelegationEvent('delegation:security_error', request, { error: error.message, reason: 'whitelist' });
      await this.auditLog.record({ beeName: fromBeeName, type: 'unauthorized_delegation', detail: error.message });
      throw error;
    }

    if (!senderContext.checkRateLimit()) {
      const error = new Error(`Delegation blocked: "${fromBeeName}" exceeded its rate limit`);
      await this.emitDelegationEvent('delegation:security_error', request, { error: error.message, reason: 'rate_limit' });
      await this.auditLog.record({ beeName: fromBeeName, type: 'rate_limit_exceeded', detail: error.message });
      throw error;
    }

    const safePrompt = this.injectionDetector.detectInjection(task);
    if (safePrompt.patterns.length > 0) {
      await this.auditLog.record({
        beeName: fromBeeName,
        type: 'injection_detected',
        detail: `risk=${safePrompt.injectionRisk.toFixed(2)}`,
        metadata: { patterns: safePrompt.patterns }
      });
    }
    const safeTask = safePrompt.sanitized;

    let secureMessage: SecureAgentMessage | undefined;

    if (this.securityOptions.enableSigning || this.securityOptions.enableEncryption) {
      const senderIdentity = this.identityManager.getBeeIdentity(fromBeeName) ?? this.identityManager.registerBeeIdentity(fromBeeName);
      // toBeeName is guaranteed registered: `targetBee` above only exists in
      // `this.bees` if it was built by this manager's createBee(), which
      // always registers its identity in this same identityManager.
      const recipientIdentity = this.identityManager.getBeeIdentity(toBeeName)!;

      secureMessage = { id: randomUUID(), from: fromBeeName, to: toBeeName, timestamp: Date.now(), data: safeTask };

      if (this.securityOptions.enableSigning) {
        const signed = this.messageSigner.sign(secureMessage.data, senderIdentity);
        secureMessage.signature = signed.signature;
        secureMessage.nonce = signed.nonce;
        secureMessage.timestamp = signed.timestamp;
      }

      if (this.securityOptions.enableEncryption) {
        const enc = this.messageEncryption.encrypt(JSON.stringify(secureMessage.data), recipientIdentity.publicKey);
        secureMessage.data = enc.encrypted;
        secureMessage.iv = enc.iv;
        secureMessage.authTag = enc.authTag;
        secureMessage.encryptedKey = enc.encryptedKey;
        secureMessage.encrypted = true;
      }

      request.secureMessage = secureMessage;

      await this.attestationChain.append({
        messageId: secureMessage.id,
        from: fromBeeName,
        to: toBeeName,
        timestamp: secureMessage.timestamp,
        signature: secureMessage.signature ?? ''
      });
    }

    await this.emitDelegationEvent('delegation:start', request);
    await this.auditLog.record({ beeName: fromBeeName, type: 'message_sent', detail: `Delegated to "${toBeeName}"` });

    try {
      const taskForTarget = secureMessage
        ? this.verifyIncomingMessage(secureMessage, fromBeeName, toBeeName)
        : safeTask;

      const result = await targetBee.run(taskForTarget, [...chain, toBeeName]);
      await this.emitDelegationEvent('delegation:complete', request, { result });
      await this.auditLog.record({ beeName: toBeeName, type: 'message_received', detail: `Processed delegation from "${fromBeeName}"` });
      return result;
    } catch (error) {
      const isSecurityFailure = error instanceof SecurityError;
      await this.emitDelegationEvent(
        isSecurityFailure ? 'delegation:security_error' : 'delegation:error',
        request,
        { error: (error as Error).message }
      );
      await this.auditLog.record({
        beeName: fromBeeName,
        type: isSecurityFailure ? 'signature_failed' : 'unauthorized_delegation',
        detail: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * Decrypts (if encrypted) and verifies the signature/nonce/timestamp
   * (if signed) of a secure message, throwing a SecurityError on any
   * failure. Returns the plaintext task ready for the target Bee.
   *
   * Used internally by delegateToAgent() for same-process delegation,
   * but public and reusable on its own: pair it with a real distributed
   * StorageProvider/EventBus and this is exactly what the receiving
   * process calls after pulling a SecureAgentMessage off the wire.
   */
  verifyIncomingMessage(message: SecureAgentMessage, fromBeeName: string, toBeeName: string): string {
    let data = message.data;

    if (message.encrypted) {
      const recipientIdentity = this.identityManager.getBeeIdentity(toBeeName);
      if (!recipientIdentity) {
        throw new SecurityError(`No identity registered for recipient "${toBeeName}"`);
      }

      try {
        const decrypted = this.messageEncryption.decrypt(
          {
            encrypted: data as string,
            iv: message.iv!,
            authTag: message.authTag!,
            encryptedKey: message.encryptedKey!
          },
          recipientIdentity.privateKey
        );
        data = JSON.parse(decrypted);
      } catch (error) {
        throw new SecurityError(`Decryption failed: ${(error as Error).message}`);
      }
    }

    if (message.signature) {
      const senderIdentity = this.identityManager.getBeeIdentity(fromBeeName);
      if (!senderIdentity) {
        throw new SecurityError(`No identity registered for sender "${fromBeeName}"`);
      }

      const verification = this.messageSigner.verify(
        data,
        { signature: message.signature, nonce: message.nonce!, timestamp: message.timestamp },
        senderIdentity
      );

      if (!verification.valid) {
        throw new SecurityError(`Message verification failed: ${verification.reason}`);
      }
    }

    return data as string;
  }

  /** Every delegation attempted through this BeeManager, oldest first. */
  getDelegationHistory(): DelegationRequest[] {
    return [...this.delegationHistory];
  }

  /** The shared RSA identity registry used to sign/encrypt/verify messages between this manager's Bees. */
  getIdentityManager(): BeeIdentityManager {
    return this.identityManager;
  }

  /** The security audit trail for every Bee this manager coordinates. */
  getAuditLog(): AuditLog {
    return this.auditLog;
  }

  /** The MessageSigner instance this manager verifies incoming delegations with (tracks seen nonces). */
  getMessageSigner(): MessageSigner {
    return this.messageSigner;
  }

  /** The full attestation chain recorded so far (only populated when signing/encryption is enabled). */
  async getAttestationChain() {
    return this.attestationChain.getChain();
  }

  /** Verifies the whole attestation chain's integrity; throws if any link was tampered with. */
  async verifyAttestationChain(): Promise<true> {
    return this.attestationChain.verify();
  }

  private async emitDelegationEvent(
    type: Extract<BeeEventType, `delegation:${string}`>,
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
