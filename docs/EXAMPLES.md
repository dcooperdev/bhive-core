# Example: Email Manager Hive with Providers

A three-Bee Email Manager Hive (classify → respond → execute), wired up
with an explicit storage provider and event bus instead of relying on
BeeManager's in-memory defaults. This is the shape you'd use to run
Hive across multiple processes sharing one Redis instance.

```typescript
import {
  BeeManager,
  InMemoryStorage,
  InMemoryEventBus,
  Tool
} from '@hiveai/core';

// --- Tools -----------------------------------------------------------

const classifyTool: Tool = {
  name: 'classify_email',
  description: 'Classify email as VIP, SPAM, or NORMAL',
  execute: async ({ from, subject }: { from: string; subject: string }) => {
    const vips = ['boss@company.com', 'ceo@company.com'];
    const spamWords = ['limited time', 'click here', 'act now'];

    if (vips.some(v => from.toLowerCase().includes(v))) {
      return JSON.stringify({ classification: 'VIP' });
    }
    if (spamWords.some(w => subject.toLowerCase().includes(w))) {
      return JSON.stringify({ classification: 'SPAM' });
    }
    return JSON.stringify({ classification: 'NORMAL' });
  }
};

const notifyTool: Tool = {
  name: 'notify_user',
  description: 'Notify the user about an important email',
  execute: async ({ message }: { message: string }) => `Notified: ${message}`
};

const labelTool: Tool = {
  name: 'apply_label',
  description: 'Apply a label to an email',
  execute: async ({ emailId, label }: { emailId: string; label: string }) =>
    `Labeled ${emailId} as ${label}`
};

// --- Providers ---------------------------------------------------------
//
// Swap these two lines for a RedisStorage/KafkaEventBus (see
// docs/PROVIDERS.md) to run the exact same Hive across multiple
// instances with a shared, durable queue and shared events.

const storageProvider = new InMemoryStorage();
const eventPublisher = new InMemoryEventBus();

// Watch every Bee's lifecycle from one place, regardless of which Bee
// or which process instance produced the event.
(eventPublisher as InMemoryEventBus).subscribe('*', event => {
  console.log(`[event] ${event.beeName} → ${event.type}`, event.data);
});

// --- Hive ----------------------------------------------------------------

const beeManager = new BeeManager('gemini-1.5-flash', {
  apiKey: process.env.GOOGLE_API_KEY,
  storageProvider,
  eventPublisher
});

beeManager.createBee({
  name: 'classifier',
  prompt: 'Classify emails as VIP/SPAM/NORMAL. Notify the user for VIP emails.',
  tools: [classifyTool, notifyTool],
  // Persistent, bounded, self-expiring queue: never grow past 500 pending
  // emails, and drop anything that waited more than 5 minutes unprocessed.
  queueConfig: { persist: true, maxSize: 500, ttl: 5 * 60_000 }
});

beeManager.createBee({
  name: 'responder',
  prompt: 'Draft a reply based on the classification.',
  tools: []
});

beeManager.createBee({
  name: 'executor',
  prompt: 'Apply the right label based on the classification and reply.',
  tools: [labelTool]
});

async function processEmail(email: { id: string; from: string; subject: string }) {
  return beeManager.executeTask(
    `Process email:\nFrom: ${email.from}\nSubject: ${email.subject}\nEmail ID: ${email.id}`,
    ['classifier', 'responder', 'executor']
  );
}

async function main() {
  await processEmail({ id: '1', from: 'boss@company.com', subject: 'Quarterly Review' });
  await processEmail({ id: '2', from: 'newsletter@marketing.com', subject: 'LIMITED TIME OFFER' });

  beeManager.printSummary();
}

main().catch(console.error);
```

## Running two instances against the same queue

Because `storageProvider` and `eventPublisher` are just interfaces, two
separate processes (or two `BeeManager` instances in a test) can point
at the same backing Redis/Kafka and the same `persistenceKey` — each
enqueues and processes its own work, but `maxSize` is enforced against
the *shared* queue length, and every instance's events are visible to
every subscriber:

```typescript
const shared = { storageProvider: new InMemoryStorage(), eventPublisher: new InMemoryEventBus() };

const instanceA = new BeeManager('gemini-1.5-flash', { apiKey, ...shared });
const instanceB = new BeeManager('gemini-1.5-flash', { apiKey, ...shared });

const queueConfig = { persist: true, persistenceKey: 'hive:classifier:queue', maxSize: 500 };

instanceA.createBee({ name: 'classifier', prompt: '...', tools: [classifyTool], queueConfig });
instanceB.createBee({ name: 'classifier', prompt: '...', tools: [classifyTool], queueConfig });
```

See `tests/integration.test.ts` (`Integration: multi-instance with
shared providers`) for the same scenario as a runnable test, including
what happens once the shared queue reaches `maxSize`.

## Example: the same Hive, driven by delegation instead of executeTask()

The version above orchestrates classifier → responder → executor from
the outside, one `executeTask()` call per Bee. This version does the
same three-Bee chain by having each Bee decide, on its own, to hand the
task to the next agent — see [docs/DELEGATION.md](./DELEGATION.md) for
the full pattern.

```typescript
import { BeeManager, createDelegationTool } from '@hiveai/core';

const beeManager = new BeeManager('gemini-1.5-flash', {
  apiKey: process.env.GOOGLE_API_KEY,
  eventPublisher // reuse the same shared bus as above for one unified event stream
});

beeManager.createBee({
  name: 'classifier',
  prompt: `Classify the email as VIP/SPAM/NORMAL using classify_email.
    For anything that needs a reply, delegate drafting one to the responder agent.`,
  tools: [classifyTool, createDelegationTool('responder', 'Delegate drafting an email response')]
});

beeManager.createBee({
  name: 'responder',
  prompt: `Draft a reply based on the classification, then delegate applying
    the outcome to the executor agent.`,
  tools: [createDelegationTool('executor', 'Delegate applying the final outcome')]
});

beeManager.createBee({
  name: 'executor',
  prompt: 'Apply the right label based on the classification and reply.',
  tools: [labelTool]
  // No delegation tool here - the executor is the end of the chain.
});

// A single call into the classifier runs the entire chain. No
// executeTask(), no manual sequencing of the three Bees.
const result = await beeManager
  .getBee('classifier')!
  .run('Process email:\nFrom: boss@company.com\nSubject: Quarterly Review\nEmail ID: 1');

beeManager.getDelegationHistory();
// [{ from: 'classifier', to: 'responder', ... }, { from: 'responder', to: 'executor', ... }]
```

Both styles compose: nothing stops a Bee reached via `executeTask()`
from *also* delegating further on its own, or a `run()`-driven chain
from being triggered as one step of a larger `executeTask()` sequence.
