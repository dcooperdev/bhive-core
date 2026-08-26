# Trust Levels

Every Bee has a `trustLevel` governing which agents it may delegate to
via `delegateTo()` / a `createDelegationTool()`-based tool. Defaults to
`'open'` — nothing changes for existing Hives unless you opt in.

| Level | Behavior |
|---|---|
| `'open'` (default) | Delegate to any agent registered with the BeeManager. |
| `'careful'` | Delegate only to names listed in `allowedDelegates`. Anything else rejects with a clear error. |
| `'strict'` | Never delegate. `delegateTo()` always rejects, even if the target exists and is whitelisted. Use tools only. |

## Usage

```typescript
beeManager.createBee({
  name: 'classifier',
  prompt: '...',
  tools: [classifyTool, createDelegationTool('responder')],
  trustLevel: 'careful',
  allowedDelegates: ['responder'] // trying to delegate anywhere else throws
});

beeManager.createBee({
  name: 'auditor',
  prompt: 'Read-only auditing agent.',
  tools: [readLogsTool],
  trustLevel: 'strict' // this agent can never delegate, by design
});
```

## Where it's enforced

The check lives in `Bee.delegateTo()`, before the call ever reaches
`BeeManager.delegateToAgent()` — a blocked delegation never touches the
target agent, never enters the delegation history, and never runs up
against a queue or rate limit it wasn't supposed to reach in the first
place.

## Choosing a level

- Use `'open'` for a small, trusted set of agents you wrote yourself —
  the common case, and the default.
- Use `'careful'` once a Bee's prompt is driven by less-trusted input
  (e.g. a Bee that reads instructions from an external source) and you
  want to cap its blast radius to a specific handoff or two.
- Use `'strict'` for agents that should only ever use their own tools —
  e.g. a final "executor" step that shouldn't be able to hand work back
  upstream at all.
