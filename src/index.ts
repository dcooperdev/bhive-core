export { BeeManager, BeeManagerOptions, BeeDefinition, BeeStats } from './bee/BeeManager';
export { Bee, BeeProviderOptions } from './bee/Bee';
export { BeeConfig, ModelLimits } from './bee/BeeConfig';
export { createDelegationTool } from './bee/delegationTools';
export { BeeSecurityContext, MessageValidationResult } from './bee/BeeSecurityContext';
export { BeeIdentityManager, getDefaultBeeIdentityManager } from './bee/BeeIdentityManager';

export { SimpleLLM } from './llm/SimpleLLM';
export { GeminiAdapter } from './adapters/GeminiAdapter';
export { InMemoryStorage } from './storage/InMemoryStorage';
export { InMemoryEventBus } from './events/InMemoryEventBus';

export {
  LLMAdapter,
  LLMToolCall,
  LLMCompletionResult,
  StorageProvider,
  ContextProvider,
  EventPublisher,
  EventSubscriber,
  EventBus,
  BeeEventHandler
} from './providers';

// --- Secure Agent Communication (v0.4.0) -----------------------------------

export { MessageSigner, SignedEnvelope, VerificationResult } from './security/MessageSigner';
export { MessageEncryption, EncryptedPayload } from './security/MessageEncryption';
export { PromptInjectionDetector } from './security/PromptInjectionDetector';
export {
  AttestationChainService,
  verifyAttestationChain,
  AttestationInput,
  GENESIS_HASH
} from './security/AttestationChain';
export { AuditLog, AuditRecordInput } from './security/AuditLog';
export { createSecureMessage, isSecureMessage, SecurityError } from './security/SecureMessage';
export {
  MTLSConfig,
  CertificatePaths,
  RedisTLSOptions,
  loadMTLSConfigFromFiles,
  loadMTLSConfigFromEnv,
  validateCertificateChain,
  toRedisTLSOptions,
  toEventBusTLSOptions
} from './security/mTLSConfig';

export {
  Tool,
  Message,
  ToolCall,
  AgentRun,
  BeeEvent,
  BeeEventType,
  QueueConfig,
  ToolExecutionContext,
  DelegationRequest,
  TrustLevel,
  BeeIdentity,
  SecureAgentMessage,
  SecurityConfig,
  BeeSecurityContextConfig,
  AttestationChain,
  AuditEventType,
  AuditEntry,
  SafePrompt
} from './types';
