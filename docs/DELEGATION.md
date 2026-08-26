# Agent-to-Agent Delegation

Bees can hand a task directly to another Bee and get its result back,
without going through `BeeManager.executeTask()`. This is Hive's
ConnectOnion-style subagent pattern — but built on the same
provider-agnostic foundation as everything else: delegation events flow
through your `EventPublisher`, and the delegated Bee still respects its
own rate limits, queue, and storage exactly like any other run.

## The three pieces

1. **`BeeManager.delegateToAgent(fromBeeName, toBeeName, task)`** — looks
   up `toBeeName` in the manager's registry and runs `task` through it
   (`targetBee.run(task, ...)`), returning its output. This is the single
   place delegation actually happens.
2. **`Bee.delegateTo(agentName, task)`** — a thin, trust-checked wrapper
   a Bee calls on itself; it forwards to its BeeManager's
   `delegateToAgent()`. Every Bee created via `createBee()` gets a
   reference to its BeeManager automatically.
3. **`createDelegationTool(agentName, description?)`** — wraps
   `delegateTo` as a normal `Tool`, so the LLM can trigger delegation the
   same way it triggers any other tool call.

## Wiring it up

```typescript
import { BeeManager, createDelegationTool } from 'bhive';

const beeManager = new BeeManager('gemini-1.5-flash', { apiKey: process.env.GOOGLE_API_KEY });

beeManager.createBee({
  name: 'classifier',
  prompt: 'Classify the email. If it needs a reply, delegate drafting one to the responder agent.',
  tools: [classifyTool, createDelegationTool('responder', 'Delegate drafting an email response')]
});

beeManager.createBee({
  name: 'responder',
  prompt: 'Draft a reply, then delegate applying it to the executor agent.',
  tools: [createDelegationTool('executor', 'Delegate applying the final outcome')]
});

beeManager.createBee({
  name: 'executor',
  prompt: 'Apply the label and archive if needed.',
  tools: [labelTool, archiveTool]
});

// One call. Classifier decides on its own whether/where to delegate -
// no executeTask(), no manual orchestration of the three Bees.
const result = await beeManager.getBee('classifier')!.run('Process email: ...');
```

`createDelegationTool` only works on a Bee created through
`BeeManager.createBee()` — the tool needs the `ToolExecutionContext` that
`Bee` passes to every tool call, which carries a `delegate()` function
bound to that specific Bee.

## Discovering other agents

```typescript
const classifier = beeManager.getBee('classifier')!;
classifier.getAvailableAgents(); // ['responder', 'executor'] - every registered Bee except itself
```

Useful for building the prompt dynamically (e.g. listing available
agents) instead of hardcoding delegation tools per Bee.

## Observability

Every delegation attempt publishes through the BeeManager's
`eventPublisher` (if configured):

| Event | When |
|---|---|
| `delegation:start` | the target agent was found and isn't part of a cycle; about to run |
| `delegation:complete` | the target agent finished; `data.result` holds its output |
| `delegation:error` | the target doesn't exist, the chain is circular, or the target's own run rejected |

The target Bee's own lifecycle events (`run:enqueued`, `run:start`,
`run:complete`, ...) fire too, attributed to the target's name — so a
delegated call is visible both as "X delegated to Y" and as "Y ran".

```typescript
beeManager.getDelegationHistory();
// [{ from: 'classifier', to: 'responder', task: '...', timestamp: ... }, ...]
```

## Circular delegation

Every `delegateToAgent()` call carries the chain of agent names already
visited. If a target is already in that chain, the call rejects with
`Circular delegation detected: a -> b -> a` instead of looping forever.
When this happens *inside* a tool call (an LLM had a delegation tool
call the failed hop), it's caught the same way any other failing tool
call is — logged, and the conversation continues — so one bad delegation
attempt doesn't crash the whole chain.

## Trust levels

See [docs/TRUST.md](./TRUST.md) for restricting which agents a Bee is
allowed to delegate to.
