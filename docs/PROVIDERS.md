# Provider Development Guide

Hive's `Bee` and `BeeManager` never import a concrete backend. They only
know about four small interfaces, all under `src/providers/`:

| Interface                     | Purpose                                              | Built-in implementation |
|--------------------------------|-------------------------------------------------------|--------------------------|
| `LLMAdapter`                   | Talk to a language model                              | `GeminiAdapter`          |
| `StorageProvider`               | Key/value + list storage, backs the persistent queue  | `InMemoryStorage`        |
| `ContextProvider`               | Persist a Bee's conversation across runs              | *(none shipped — see below)* |
| `EventPublisher` / `EventSubscriber` (together: `EventBus`) | Publish/observe Bee lifecycle events | `InMemoryEventBus`       |

Everything under `src/adapters/`, `src/storage/`, and `src/events/` is
an *example* implementation, not part of the contract. Write your own
against the interface and pass an instance into `BeeManager`/`createBee`
— nothing else needs to change.

## LLMAdapter

```typescript
import { LLMAdapter } from '@bhive/core';

class OpenAIAdapter implements LLMAdapter {
  readonly name = 'openai';
  private tokens = 0;
  private calls = 0;
  private model: string;

  constructor(private apiKey: string, model = 'gpt-4o-mini') {
    this.model = model;
  }

  async complete(messages, tools) {
    this.calls++;
    // Call the OpenAI API, map its response into { content, toolCalls }.
    // toolCalls (if any) must be [{ name, params }, ...].
    const { content, usage } = await callOpenAI(this.apiKey, this.model, messages, tools);
    this.tokens += usage.total_tokens;
    return { content, toolCalls: [] };
  }

  getTokens() { return this.tokens; }
  getCallCount() { return this.calls; }
  resetStats() { this.tokens = 0; this.calls = 0; }
  setModel(model: string) { this.model = model; }
  getModel() { return this.model; }
}
```

Rules an adapter must follow so `Bee`'s retry/timeout logic keeps working:
- On an overloaded/retryable upstream error, reject with an `Error` whose `.response.status === 503` — `Bee` doubles its delay and retries automatically.
- Otherwise just reject with a normal `Error`; `Bee` logs it, records the run as failed, and moves on. It never needs special handling from the adapter.
- `complete()` should resolve `{ content, toolCalls? }` even when the model didn't call any tools (return `toolCalls: []` or omit it).

Wire it in:

```typescript
const beeManager = new BeeManager('gpt-4o-mini', {
  llmAdapter: new OpenAIAdapter(process.env.OPENAI_API_KEY!)
});
```

## StorageProvider

Backs the Bee queue (and anything else you want to persist). Needs a
plain key/value store plus a FIFO list:

```typescript
import { StorageProvider } from '@bhive/core';
import { createClient } from 'redis';

class RedisStorage implements StorageProvider {
  readonly name = 'redis';
  constructor(private client: ReturnType<typeof createClient>) {}

  async get<T>(key: string) {
    const raw = await this.client.get(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  }
  async set<T>(key: string, value: T, ttlMs?: number) {
    await this.client.set(key, JSON.stringify(value), ttlMs ? { PX: ttlMs } : undefined);
  }
  async delete(key: string) { await this.client.del(key); }
  async has(key: string) { return (await this.client.exists(key)) === 1; }

  async pushToList<T>(key: string, value: T) {
    await this.client.rPush(key, JSON.stringify(value));
  }
  async popFromList<T>(key: string) {
    const raw = await this.client.lPop(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  }
  async listLength(key: string) { return this.client.lLen(key); }
  async clearList(key: string) { await this.client.del(key); }
}
```

A `MongoStorage`/`PostgresStorage` implementation looks the same shape:
a document/table for the KV side, and an ordered collection/table for
the list side (`ORDER BY created_at` + delete-on-pop, or a Mongo
capped/queue collection).

### How Bee uses it

`Bee` only calls `pushToList`/`popFromList`/`listLength` on the queue
key (`bee:{name}:queue` by default, or `queueConfig.persistenceKey`).
Enabling `queueConfig.persist: true` with a `storageProvider` gives you:
- **Capacity accounting shared across instances** — every instance
  enqueuing against the same key sees the same `listLength()`, so
  `queueConfig.maxSize` is enforced Hive-wide, not per-process.
- **Durability/introspection** — the queue's contents live in Redis/Mongo/etc., so you can inspect or drain it outside the process.

What it does **not** give you out of the box is distributed work-stealing:
each Bee instance still processes exactly the item its own `run()` call
enqueued (this keeps `run()`'s return value always correct for its
caller). If you need true cross-process draining, pair `StorageProvider`
with `EventBus`: publish a `run:complete` event carrying the result, and
have the originating instance await it instead of a local promise.

## ContextProvider

No built-in implementation ships (it's a thin, storage-shaped
interface — reuse your `StorageProvider`'s backend if you have one):

```typescript
import { ContextProvider } from '@bhive/core';

class RedisContext implements ContextProvider {
  readonly name = 'redis';
  constructor(private client: RedisClient) {}
  async getContext<T>(key: string) { /* same shape as StorageProvider.get */ }
  async setContext<T>(key: string, value: T, ttlMs?: number) { /* ... */ }
  async deleteContext(key: string) { /* ... */ }
  async hasContext(key: string) { /* ... */ }
}
```

When set, `Bee` loads up to the last 20 messages under
`bee:{name}:context` before each run and saves the updated conversation
after — giving the Bee multi-turn memory across calls (and across
restarts, if the backend is durable).

## EventBus (EventPublisher + EventSubscriber)

```typescript
import { EventBus, BeeEventHandler } from '@bhive/core';

class KafkaEventBus implements EventBus {
  readonly name = 'kafka';
  constructor(private producer: Producer, private consumer: Consumer) {}

  async publish(event) {
    await this.producer.send({ topic: 'hive-events', messages: [{ value: JSON.stringify(event) }] });
  }

  subscribe(eventType: string, handler: BeeEventHandler) {
    const onMessage = ({ message }) => {
      const event = JSON.parse(message.value!.toString());
      if (eventType === '*' || event.type === eventType) handler(event);
    };
    this.consumer.on('message', onMessage);
    return () => this.consumer.off('message', onMessage);
  }
}
```

`Bee` publishes: `run:enqueued`, `run:start`, `run:complete`,
`run:error`, `retry`, `queue:full`, `queue:expired`. A failing
`publish()` is caught and logged — it never breaks the Bee's own run.

## Testing a custom provider

Every built-in provider is tested through a **contract test** —
one shared spec of behavior run against every implementation
(`tests/providers/StorageProvider.test.ts`,
`tests/providers/LLMAdapter.test.ts`). Point the same
`describe*Contract(name, factory)` helper at your own implementation to
confirm it satisfies the interface before wiring it into a Bee.
