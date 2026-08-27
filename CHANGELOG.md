# Changelog

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
