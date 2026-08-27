# Changelog

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
