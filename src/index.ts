export { BeeManager, BeeManagerOptions, BeeDefinition, BeeStats } from './bee/BeeManager';
export { Bee, BeeProviderOptions } from './bee/Bee';
export { BeeConfig, ModelLimits } from './bee/BeeConfig';
export { createDelegationTool } from './bee/delegationTools';
export { BeeSecurityContext, MessageValidationResult } from './bee/BeeSecurityContext';
export { BeeIdentityManager, getDefaultBeeIdentityManager } from './bee/BeeIdentityManager';

export { SimpleLLM } from './llm/SimpleLLM';
export { InMemoryStorage } from './storage/InMemoryStorage';
export { InMemoryEventBus } from './events/InMemoryEventBus';

export {
  LLMAdapter,
  LLMResponse,
  LLMCompletionResult,
  StorageProvider,
  ContextProvider,
  EventPublisher,
  EventSubscriber,
  EventBus,
  BeeEventHandler
} from './providers';

// --- LLM adapters - provider-agnostic tool-calling (v0.5.0) ----------------

export { BaseLLMAdapter, GeminiAdapter, OpenAIAdapter, AnthropicAdapter, OllamaAdapter } from './llm/adapters';
export { ToolCallingParser, ProviderHint } from './llm/ToolCallingParser';
export {
  createLLMAdapter,
  isKnownProvider,
  PROVIDER_REGISTRY,
  LLMProviderName,
  ProviderDescriptor
} from './llm/providerRegistry';
export { toGeminiFunctionDeclarations } from './llm/toolCallingFormatters/geminiToolFormatter';
export { toOpenAITools } from './llm/toolCallingFormatters/openaiToolFormatter';
export { toAnthropicTools } from './llm/toolCallingFormatters/anthropicToolFormatter';

// --- Secure Agent Communication (v0.4.0) -----------------------------------

export { ToolCallValidator, ToolCallValidationResult } from './security/ToolCallValidator';
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
  ToolParameterSchema,
  Message,
  RawToolCall,
  ValidatedToolCall,
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
