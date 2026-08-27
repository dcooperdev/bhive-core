# 🐝 Hive - Multi-Agent AI Framework for Production

Multi-Agent Framework for Production.

Your agents. Your infrastructure.

✅ Queue-based concurrency (no DAGs, no state machines)  
✅ Storage-agnostic (Redis, Mongo, SQL—your choice)  
✅ Event-driven architecture (Kafka, WebSocket, etc)  
✅ LLM-agnostic (Gemini, OpenAI, Anthropic, local)  
✅ Agent-to-agent delegation (subagents, ConnectOnion-style)  
✅ Secure by default: signed, encrypted, injection-resistant agent messages  
✅ Kubernetes-ready, day 1  
✅ Distributed from the start  

Stop building for single-instance.
Start building for production.

## Quick Start

### 1. Install Dependencies
`npm install @bhive/core`

### 2. Setup .env
`cp .env.example .env`

# Edit .env and add your Google (Gemini) API key

### 3. Build
`npm run build`

### 4. Run Tests
`npm test`

## Usage

```typescript
import { BeeManager } from '@bhive/core';

// No providers given: BeeManager falls back to a GeminiAdapter and a
// plain in-memory queue, no configuration required.
const beeManager = new BeeManager('gemini-1.5-flash');

beeManager.createBee({
  name: 'classifier',
  prompt: 'Classify emails as WORK/SPAM/NORMAL',
  tools: [classifyTool]
});

await beeManager.executeTask('Process email: ...', ['classifier']);

// Plan upgraded? Reconfigure every Bee in memory, no restart of the process needed.
beeManager.restart('gemini-1.5-pro');
```

### Injecting providers

```typescript
import { BeeManager, InMemoryStorage, InMemoryEventBus } from '@bhive/core';

const beeManager = new BeeManager('gemini-1.5-flash', {
  apiKey: process.env.GOOGLE_API_KEY,
  storageProvider: new InMemoryStorage(),   // swap for a RedisStorage, MongoStorage, ...
  eventPublisher: new InMemoryEventBus()    // swap for a KafkaEventBus, WebSocketEventBus, ...
});

beeManager.createBee({
  name: 'classifier',
  prompt: 'Classify emails as WORK/SPAM/NORMAL',
  tools: [classifyTool],
  // Persistent, bounded, self-expiring queue backed by the storageProvider above.
  queueConfig: { persist: true, maxSize: 1000, ttl: 60_000 }
});
```

Every provider can also be overridden per-Bee (`createBee({ llmAdapter, storageProvider, contextProvider, eventPublisher, ... })`) when one Bee needs a different backend than the rest of the Hive.

See [docs/PROVIDERS.md](./docs/PROVIDERS.md) for how to write a custom adapter, and [docs/EXAMPLES.md](./docs/EXAMPLES.md) for a full Email Manager Hive built on providers.

### Agent-to-agent delegation

Bees can hand a task directly to another Bee and get its result back —
no `executeTask()` orchestration required. Attach a delegation tool and
let the LLM decide when to use it:

```typescript
import { BeeManager, createDelegationTool } from '@bhive/core';

const beeManager = new BeeManager('gemini-1.5-flash');

beeManager.createBee({
  name: 'classifier',
  prompt: 'Classify the email, then delegate drafting a reply to the responder agent.',
  tools: [classifyTool, createDelegationTool('responder', 'Delegate email response')]
});

beeManager.createBee({
  name: 'responder',
  prompt: 'Draft a professional reply.',
  tools: []
});

// One call. Classifier decides on its own whether to delegate to responder.
const result = await beeManager.getBee('classifier')!.run('Process email: ...');
```

Delegation respects the same providers as everything else in Hive:
attempts publish `delegation:start`/`delegation:complete`/`delegation:error`
through the configured `EventPublisher`, circular delegation chains are
rejected instead of looping forever, and a Bee's `trustLevel` can
restrict who it's allowed to delegate to at all. See
[docs/DELEGATION.md](./docs/DELEGATION.md) and [docs/TRUST.md](./docs/TRUST.md).

### Secure agent communication

Every delegation already runs through a security pipeline - sender
whitelist/rate-limit checks and prompt-injection scanning happen
unconditionally, with permissive defaults so nothing changes until you
opt in. Turn on signing and end-to-end encryption per `BeeManager`:

```typescript
const beeManager = new BeeManager('gemini-1.5-flash', {
  apiKey: process.env.GOOGLE_API_KEY,
  securityOptions: { enableSigning: true, enableEncryption: true, trustLevel: 'careful' }
});
```

Every Bee gets an RSA-2048 identity automatically. Signed messages use
HMAC-SHA256 with nonce/timestamp replay protection; encrypted messages
use hybrid RSA-OAEP + AES-256-GCM so only the intended recipient can
ever decrypt. Every hop is chained into a tamper-evident SHA-256
attestation chain and recorded to an `AuditLog`. See
[docs/SECURITY.md](./docs/SECURITY.md) for the full threat model,
[docs/SECURITY_EXAMPLES.md](./docs/SECURITY_EXAMPLES.md) for complete
examples, and [docs/HACKING_LAB.md](./docs/HACKING_LAB.md) to watch
each attack (interception, forgery, injection, replay, escalation)
actually get caught.

## Features
- Auto-detected rate limits, delays, and timeouts per model (`BeeConfig`)
- **Provider Pattern**: `LLMAdapter`, `StorageProvider`, `ContextProvider`, `EventPublisher`/`EventSubscriber` — Hive depends only on these interfaces, never on a concrete backend
- **Agent-to-agent delegation**: `Bee.delegateTo()` / `BeeManager.delegateToAgent()` / `createDelegationTool()`, with circular-delegation detection and per-Bee `trustLevel`
- **Secure agent communication**: HMAC-SHA256 signing with replay protection, hybrid RSA-OAEP + AES-256-GCM end-to-end encryption, prompt-injection detection/sanitization, a SHA-256 attestation chain, and a full `AuditLog` — all opt-in and backward compatible
- Storage-backed, multi-instance-safe queue with `maxSize` and `ttl`, or a plain in-memory queue when no storage is configured
- Conversation context persisted across runs via `ContextProvider`
- Bee lifecycle events (`run:start`, `run:complete`, `run:error`, `retry`, `queue:full`, `queue:expired`, ...) published through `EventPublisher`
- Exponential backoff retry on 503 errors, timeout handling per model
- Token/cost tracking and a `printSummary()` / `getBeeStats()` report
- In-memory `restart()` to reconfigure all Bees after a plan change

## LLM Providers

Bhive supports multiple LLM providers out of the box:

✅ **Gemini** (Google) - Full tool-calling support
✅ **OpenAI** (GPT-4, GPT-3.5) - Full tool-calling support
✅ **Anthropic** (Claude) - Full tool-calling support
✅ **Ollama** (Local/Self-hosted) - Best-effort support

### Quick Start

```typescript
// Automatic detection from env var LLM_PROVIDER
const manager = new BeeManager();

// Or explicit selection
const manager = new BeeManager({
  llmProvider: 'openai',  // or 'anthropic', 'gemini', 'ollama'
});
```

See [docs/LLM_PROVIDERS.md](docs/LLM_PROVIDERS.md) for detailed setup for each provider.

### Known issues & limitations

**Gemini model deprecation**: `gemini-1.5-flash` and `gemini-1.5-pro` have
been retired by Google and will fail with a 404. They're still in the model
registry (marked deprecated) for backward compatibility, but new code should
use a current model:

- `gemini-flash-2.0` (recommended, the new default)
- `gemini-flash-lite-latest`
- `gemini-3.6-flash`

A valid model that simply isn't in the registry yet still works — it falls
back to conservative rate limits with no warning. See
[docs/LLM_PROVIDERS.md](docs/LLM_PROVIDERS.md) for the full list.

## Architecture
See [HIVE_SPEC.md](./HIVE_SPEC.md) for the original design, [HIVE_TEST_SPEC.md](./HIVE_TEST_SPEC.md) for the test strategy, [docs/PROVIDERS.md](./docs/PROVIDERS.md) for the Provider Pattern this version is built on, [docs/DELEGATION.md](./docs/DELEGATION.md) / [docs/TRUST.md](./docs/TRUST.md) for agent-to-agent delegation, and [docs/SECURITY.md](./docs/SECURITY.md) for the secure communication protocol.

```
src/
├── providers/           — provider interfaces (the only things Bee/BeeManager depend on)
│   ├── LLMAdapter.ts
│   ├── StorageProvider.ts
│   ├── ContextProvider.ts
│   └── EventBus.ts       — EventPublisher + EventSubscriber
├── adapters/
│   └── GeminiAdapter.ts  — LLMAdapter wrapping SimpleLLM
├── storage/
│   └── InMemoryStorage.ts — StorageProvider for dev/tests
├── events/
│   └── InMemoryEventBus.ts — EventBus for dev/tests
├── llm/
│   └── SimpleLLM.ts      — raw HTTP client for the Gemini API
├── security/
│   ├── MessageSigner.ts          — HMAC-SHA256 signing + nonce replay protection
│   ├── MessageEncryption.ts      — hybrid RSA-OAEP + AES-256-GCM end-to-end encryption
│   ├── PromptInjectionDetector.ts — pattern-based injection detection/sanitization
│   ├── AttestationChain.ts       — SHA-256 hash chain over signed messages
│   ├── AuditLog.ts               — security event trail (StorageProvider-backed, optional)
│   ├── SecureMessage.ts          — SecureAgentMessage helpers + SecurityError
│   └── mTLSConfig.ts             — mTLS credential loading for Redis/Kafka/etc backends
├── bee/
│   ├── BeeConfig.ts            — model limits registry + auto-detection
│   ├── Bee.ts                  — individual auto-configured agent
│   ├── BeeManager.ts           — global orchestrator + agent registry/secure delegation
│   ├── delegationTools.ts      — createDelegationTool() Tool factory
│   ├── BeeSecurityContext.ts   — per-Bee whitelist/rate limit/tool policy
│   └── BeeIdentityManager.ts   — RSA-2048 identity registry
├── types.ts              — Tool, Message, ToolCall, AgentRun, BeeEvent, QueueConfig, DelegationRequest, SecureAgentMessage, BeeIdentity, AttestationChain, AuditEntry, SafePrompt
└── index.ts              — public package exports
```

## Testing

```bash
npm test              # run all tests
npm run test:watch    # watch mode
npm run test:coverage # coverage report
npm run test:ci       # CI mode (coverage thresholds enforced)
```

Tests never call a real LLM API or a real Redis/Mongo — `axios` is
mocked and every provider is exercised through `MockLLM`
(`tests/__mocks__/MockLLM.ts`) plus the in-memory provider
implementations, so results are fast and reproducible. The security
suite (`tests/security/`) is the one place that intentionally does
real cryptography — genuine RSA-2048 keys, real AES-256-GCM
encrypt/decrypt, real HMAC-SHA256 signatures — since that's exactly
what needs proving, not mocking.
