# 🐝 Hive - Multi-Agent AI Framework for Production

Multi-Agent Framework for Production.

Your agents. Your infrastructure.

✅ Queue-based concurrency (no DAGs, no state machines)
✅ Storage-agnostic (Redis, Mongo, SQL—your choice)
✅ Event-driven architecture (Kafka, WebSocket, etc)
✅ LLM-agnostic (Gemini, OpenAI, Anthropic, local)
✅ Kubernetes-ready, day 1
✅ Distributed from the start

Stop building for single-instance.
Start building for production.

## Quick Start

### 1. Install Dependencies
`npm install`

### 2. Setup .env
`cp .env.example .env`

# Edit .env and add your Google (Gemini) API key

### 3. Build
`npm run build`

### 4. Run Tests
`npm test`

## Usage

```typescript
import { BeeManager } from '@hiveai/core';

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
import { BeeManager, InMemoryStorage, InMemoryEventBus } from '@hiveai/core';

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

## Features
- Auto-detected rate limits, delays, and timeouts per model (`BeeConfig`)
- **Provider Pattern**: `LLMAdapter`, `StorageProvider`, `ContextProvider`, `EventPublisher`/`EventSubscriber` — Hive depends only on these interfaces, never on a concrete backend
- Storage-backed, multi-instance-safe queue with `maxSize` and `ttl`, or a plain in-memory queue when no storage is configured
- Conversation context persisted across runs via `ContextProvider`
- Bee lifecycle events (`run:start`, `run:complete`, `run:error`, `retry`, `queue:full`, `queue:expired`, ...) published through `EventPublisher`
- Exponential backoff retry on 503 errors, timeout handling per model
- Token/cost tracking and a `printSummary()` / `getBeeStats()` report
- In-memory `restart()` to reconfigure all Bees after a plan change

## Architecture
See [HIVE_SPEC.md](./HIVE_SPEC.md) for the original design, [HIVE_TEST_SPEC.md](./HIVE_TEST_SPEC.md) for the test strategy, and [docs/PROVIDERS.md](./docs/PROVIDERS.md) for the Provider Pattern this version is built on.

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
├── bee/
│   ├── BeeConfig.ts      — model limits registry + auto-detection
│   ├── Bee.ts            — individual auto-configured agent
│   └── BeeManager.ts     — global orchestrator
├── types.ts              — Tool, Message, ToolCall, AgentRun, BeeEvent, QueueConfig
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
implementations, so results are fast and reproducible.
