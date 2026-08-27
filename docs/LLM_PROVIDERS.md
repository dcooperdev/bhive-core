# LLM Providers

`@bhive-ai/core` ships four `LLMAdapter` implementations. Every one of
them sends tools in that provider's native format and parses tool calls back
out through the same `ToolCallingParser`, so a Bee's prompt/tools/behavior
don't change when you switch providers - only the adapter does.

## Tool-calling support matrix

| Provider  | Tool-calling | Auth                              | Notes                                                  |
|-----------|:------------:|------------------------------------|---------------------------------------------------------|
| Gemini    | ✅ Full      | `GOOGLE_API_KEY`                   | Sends `functionDeclarations` and parses `functionCall` parts back out. |
| OpenAI    | ✅ Full      | `OPENAI_API_KEY`                   | Chat Completions `tools` / `tool_calls`.                |
| Anthropic | ✅ Full      | `ANTHROPIC_API_KEY`                | Messages API `tools` / `tool_use` content blocks.       |
| Ollama    | ⚠️ Basic     | none (local)                       | Best-effort: only tool-calling-capable local models (llama3.1, mistral-nemo, qwen2.5, ...) actually use `tools`; others silently answer in plain text instead of erroring. |

## Choosing a provider

Set `LLM_PROVIDER` in `.env` (see `.env.example`) or pass `llmProvider`
directly:

```ts
import { BeeManager } from '@bhive-ai/core';

const manager = new BeeManager({ llmProvider: 'openai' }); // reads OPENAI_API_KEY from env
```

The legacy positional form still works and is unaffected by any of this:

```ts
const manager = new BeeManager('gemini-flash-2.0', { apiKey: '...' });
```

## Supported models by provider

`BeeConfig` (`src/bee/BeeConfig.ts`) keeps the per-model rate limits, delays
and token limits. A model that isn't listed still works - it just falls back
to conservative defaults (10 req/min, 5s delay) until you register real limits
via `beeManager.updateModelLimits(...)`.

### Google Gemini

**Current models** (2026-08):

| Model                      | Notes                                              |
|----------------------------|----------------------------------------------------|
| `gemini-flash-2.0`         | Latest, fastest, largest free quota (**default**)  |
| `gemini-flash-lite-latest` | Lite variant, moderate quota                       |
| `gemini-3.6-flash`         | Smaller, good for simple/high-volume tasks         |
| `gemini-2.0-pro`           | Most capable, smaller quota                        |

**Legacy models** (registered but deprecated - retired from Google's API,
calls will fail with 404):

- `gemini-1.5-flash`
- `gemini-1.5-pro`

`getModelLimits()` prints a one-line deprecation warning when a deprecated
model is used. Migrate to `gemini-flash-2.0` (or another current model above).

### OpenAI

- `gpt-4o` — most capable
- `gpt-4o-mini` — cost-effective, the registry default
- `gpt-4-turbo` — older, still available

### Anthropic

- `claude-3-5-sonnet-20241022` — the registry default
- `claude-3-opus-20250219` — most capable (higher cost)
- `claude-3-haiku-20250307` — lightweight

### Ollama (local)

- `llama3.1` — the registry default, real tool-calling support
- `mistral-nemo`, `qwen2.5` — also tool-calling-capable
- other local models run but answer in plain text instead of calling tools

### Gemini

```ts
import { BeeManager } from '@bhive-ai/core';
const manager = new BeeManager({ llmProvider: 'gemini', apiKey: process.env.GOOGLE_API_KEY });
```

### OpenAI

```ts
import { BeeManager } from '@bhive-ai/core';
const manager = new BeeManager({ llmProvider: 'openai', apiKey: process.env.OPENAI_API_KEY, model: 'gpt-4o-mini' });
```

### Anthropic

```ts
import { BeeManager } from '@bhive-ai/core';
const manager = new BeeManager({ llmProvider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY, model: 'claude-3-5-sonnet-20241022' });
```

### Ollama (local)

No API key. Point `OLLAMA_BASE_URL` at your local (or remote) Ollama server
- it defaults to `http://localhost:11434`.

```ts
import { BeeManager } from '@bhive-ai/core';
const manager = new BeeManager({ llmProvider: 'ollama', model: 'llama3.1' });
```

Pick a model that actually supports Ollama's `tools` field if you need real
tool-calling - check with `ollama show <model>` (look for a `Tools` capability
in the output). A model without it will still run, it just won't call tools.

## Timeout configuration

Every LLM call has a per-request timeout, enforced at two layers that are kept
in sync: the adapter's HTTP request (axios) and the Bee-level wrapper in
`Bee.callWithRetry()`. Defaults: **60s** for the hosted providers, **120s** for
Ollama (local models are slower).

Resolution order, most specific wins:

1. an explicit argument — `new BeeManager({ timeout })` or `new GeminiAdapter(key, model, timeout)`
2. the provider-specific env var — `GEMINI_TIMEOUT`, `OPENAI_TIMEOUT`, `ANTHROPIC_TIMEOUT`, `OLLAMA_TIMEOUT`
3. the generic `BEE_TIMEOUT` env var
4. the built-in default (60s / 120s)

```bash
# env vars are milliseconds
GEMINI_TIMEOUT=120000 npm run analyze
BEE_TIMEOUT=90000      # applies to whichever provider is active
```

```ts
// via BeeManager - sets both the adapter HTTP timeout and the Bee wrapper
const manager = new BeeManager({ llmProvider: 'gemini', timeout: 90_000 });

// or directly on an adapter you build yourself
const adapter = new GeminiAdapter(apiKey, 'gemini-flash-2.0', 90_000);
```

### Troubleshooting timeouts

- **"Timeout after 30000ms"** — you're on `@bhive-ai/core` < 0.5.2. Upgrade, or set `BEE_TIMEOUT`.
- **"Timeout after 60000ms" / "timeout of 60000ms exceeded"** on large jobs — raise `GEMINI_TIMEOUT` (e.g. `120000`).
- **Ollama** on modest hardware — `OLLAMA_TIMEOUT=180000` is not unreasonable.
- A pre-built `llmAdapter` passed to `BeeManager` keeps its own HTTP timeout; `BeeManager({ timeout })` only widens the Bee wrapper for it.

## Adding your own provider

Implement `LLMAdapter` (`src/providers/LLMAdapter.ts`):

```ts
import { LLMAdapter, LLMResponse, Message, Tool } from '@bhive-ai/core';

class MyAdapter implements LLMAdapter {
  readonly name = 'my-provider';
  async complete(messages: Message[], tools: Tool[] = []): Promise<LLMResponse> {
    // 1. Convert `tools` to your provider's native tool/function schema.
    //    See src/llm/toolCallingFormatters/*.ts for the pattern - each one
    //    is ~15 lines mapping Tool.parameters (a small JSON-schema subset)
    //    into that provider's shape.
    // 2. Call your provider's HTTP API with messages + tools.
    // 3. Extract tool calls with ToolCallingParser.parseFunctionCalls(
    //      response.data, 'auto'  // or add a case for your shape in ToolCallingParser
    //    ), or write your own extraction inline if the shape is unusual.
    // 4. Return { content, toolCalls } - toolCalls must always be an array.
    throw new Error('not implemented');
  }
  getTokens() { return 0; }
  getCallCount() { return 0; }
  resetStats() {}
  setModel() {}
  getModel() { return 'my-model'; }
}
```

Then either pass an instance directly:

```ts
new BeeManager({ llmAdapter: new MyAdapter() });
```

or register it in `src/llm/providerRegistry.ts` (`PROVIDER_REGISTRY`) so it's
selectable via `llmProvider: 'my-provider'` / `LLM_PROVIDER=my-provider` like
the built-in four.

Whatever you do, don't hand-roll tool-call *validation* in your adapter -
`Bee.ts` already runs every call your adapter reports through
`ToolCallValidator` (existence check, Bee-level allowlist, prototype-pollution
and injection-pattern guards) before anything gets executed. Your adapter's
only job is turning the provider's response into `RawToolCall[]`.
