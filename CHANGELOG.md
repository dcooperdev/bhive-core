# Changelog

## v0.5.2 - Configurable Timeouts (Aug 27, 2026)

### 🐛 Fixes
- Raise the default per-request timeout from 30s to 60s (120s for Ollama) - fixes "Timeout after 30000ms" in multi-step agent runs on slow networks / large payloads
- `GeminiAdapter`, `OpenAIAdapter`, `AnthropicAdapter`, `OllamaAdapter` all updated; both timeout layers (adapter HTTP call + `Bee.callWithRetry()` wrapper) now move together
- `GeminiAdapter`'s own default model updated `gemini-1.5-flash` → `gemini-flash-2.0` to match the registry default from v0.5.1

### ⚙️ Configuration
- Timeout is now configurable, most-specific wins:
  1. explicit arg: `new BeeManager({ timeout: 90000 })` or `new GeminiAdapter(key, model, 90000)`
  2. provider env var: `GEMINI_TIMEOUT`, `OPENAI_TIMEOUT`, `ANTHROPIC_TIMEOUT`, `OLLAMA_TIMEOUT`
  3. generic env var: `BEE_TIMEOUT`
  4. built-in default (60s / 120s)
- `BeeConfig` accepts `{ timeoutMs }` to override every model's Bee-level timeout
- `LLMAdapter` interface documents an optional `timeout` field

### 📚 Documentation
- New "Timeout configuration" + troubleshooting section in docs/LLM_PROVIDERS.md
- Timeout env vars documented in .env.example
- README troubleshooting section

### ✅ Tests
- `tests/llm/adapters/timeout.test.ts` - resolution precedence + per-adapter wiring
- `BeeManager` timeout-propagation tests (option, `BEE_TIMEOUT`, pre-built adapter)

## v0.5.1 - Provider Registry Update (Aug 27, 2026)

### 🔧 Fixes
- Add current Gemini models to the model registry (`gemini-flash-2.0`, `gemini-flash-lite-latest`, `gemini-3.6-flash`, `gemini-2.0-pro`)
- Change the default Gemini model from `gemini-1.5-flash` to `gemini-flash-2.0`
- Mark retired Gemini models (`gemini-1.5-flash`, `gemini-1.5-pro`) as `deprecated` in the registry; `getModelLimits()` now warns when one is used
- Remove the "Unknown model, using conservative defaults" warning for models that simply aren't registered yet (custom or newer provider variants) — conservative defaults are still applied, just silently

### 📚 Documentation
- Add a "Supported models by provider" section to `docs/LLM_PROVIDERS.md` with current and deprecated Gemini models
- Add a "Known issues & limitations" note on Gemini model deprecation to the README

### ✅ Tests
- Add `tests/bee/providerRegistry.test.ts` covering current model registration, deprecation marking, and silent fallback for unregistered models

## v0.5.0 - Provider-Agnostic Tool-Calling (Aug 26, 2026)

### ✨ Features
- Multi-LLM Provider Support: Bhive now truly supports Gemini, OpenAI, Anthropic, and Ollama
- ToolCallValidator: Robust validation for all tool calls with injection guards, size limits, and allowlists
- ToolCallingParser: Unified parser for tool responses across all providers
- Auto-Provider Detection: LLM_PROVIDER env var automatically selects correct adapter
- Provider-Specific Adapters: OpenAI, Anthropic, and Ollama adapters with full tool-calling

### 🐛 Fixes
- GeminiAdapter now properly sends tools to the Gemini API and parses responses
- Failed tool calls are now reported back to conversation (no silent failures)
- Tool execution loop properly validates all calls before execution

### 🔒 Security Enhancements
- ToolCallValidator prevents prototype pollution attacks
- ToolCallValidator detects and blocks injection patterns
- Per-Bee tool allowlists are respected
- Size limits prevent denial-of-service attacks

### 📚 Documentation
- New docs/LLM_PROVIDERS.md with setup instructions for each provider
- Provider support matrix showing capabilities
- Guide for adding your own LLM provider

### ✅ Testing
- New tests covering all adapters (Gemini, OpenAI, Anthropic, Ollama), ToolCallingParser, and ToolCallValidator
- End-to-end tool-calling verified across all providers
- Security validator comprehensive tests

### 🙏 Credits
Special thanks to Leandro for designing and implementing the provider-agnostic
tool-calling infrastructure and comprehensive testing this release is based on.

### 📌 Breaking Changes
None. Fully backward compatible with v0.4.0.
