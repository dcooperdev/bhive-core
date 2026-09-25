# Changelog

## v0.6.0 - Asymmetric Security Layer (Sep 24, 2026)

**Breaking release.** `BeeIdentity`, `BeeIdentityManager`, `MessageSigner`,
`MessageEncryption`, `SecureAgentMessage` and `StorageProvider` all changed,
with no compatibility shim. See [docs/MIGRATION_0.6.md](./docs/MIGRATION_0.6.md).
Fixes all four items from the v0.5.x security audit.

### 💥 Breaking changes
- **Ed25519 signatures replace HMAC-with-shared-secret.** `MessageSigner.verify()` is now `async` and takes the sender's `signingPublicKey` instead of a full identity. Verifiers never need a secret, so a compromised verifier (e.g. `BeeManager`) can't forge a Bee's signature.
- **Separate signing and encryption keys.** `BeeIdentity.publicKey`/`privateKey` (one RSA-2048 key for both jobs) are removed. They're replaced by an Ed25519 signing keypair and X25519 encryption keypairs (`signingPublicKey`, `encryptionPublicKey`, `encryptionKeyId`, `encryptionKeySignature`, plus the private halves). Keys are base64 DER.
- **Forward-secret encryption replaces static RSA-OAEP.** `MessageEncryption` generates a fresh X25519 keypair per message, then does ECDH with the recipient's current key, HKDF-SHA256 (salt = both public keys, info = algorithm + key id) and AES-256-GCM, with the header bound as additional data and the tag length pinned. The new envelope is `{ alg, ephemeralPublicKey, recipientKeyId, iv, authTag, ciphertext }`. Recipient encryption keys **rotate** (default every 15 min) and old private keys are **deleted** after a retention window (default 5 min). Stealing a Bee's keys at time T no longer exposes traffic encrypted to keys deleted before T.
- **Private keys stay with their Bee.** `BeeIdentityManager` is now a public-key registry. `registerBeeIdentity()` returns the private `BeeKeyring` once and throws on duplicate names. `getBeeIdentity()` returns `BeePublicIdentity` only. `loadIdentity()` accepts public identities and checks their encryption-key signature. `Bee.getIdentity()` is public-only.
- **BeeManager no longer signs or decrypts on Bees' behalf.** It asks the sending Bee to seal (`Bee.sealMessage()`) and the receiving Bee to open (`Bee.openMessage()`), then verifies with public keys only. `verifyIncomingMessage()` is now `async`. For non-Bee senders (e.g. `"system"`), BeeManager signs with a keyring it owns for that name, and refuses names whose keys belong to someone else.
- **Signed delegation content now covers `{ id, from, to, data }`**, so a signed message can't be re-addressed, re-attributed or re-id'd.
- **Signature sealed inside the ciphertext.** For signed + encrypted messages, `{ data, signature }` is encrypted together and `message.signature` is unset. A visible signature over the plaintext would let an eavesdropper confirm guesses of low-entropy payloads offline. Receiving is strictly decrypt-then-verify. `Bee.openMessage()` / `openSecureMessage()` return `{ data, signature? }`. Signed-only messages are unchanged.
- **Unsigned messages are rejected when `enableSigning` is on.** GCM only proves a message was encrypted *to* a Bee, not by whom, so an unsigned encrypted message is treated as a downgrade attempt.
- `AttestationChain` records a `sha256:` envelope digest (`attestationFingerprint()`) for encrypted messages instead of the signature.
- **`StorageProvider.setIfNotExists(key, value, ttlMs)`** is a new required method: an atomic set-if-absent with TTL (Redis `SET NX PX`, SQL `INSERT ... ON CONFLICT DO NOTHING`). Implemented in `InMemoryStorage`.
- **Atomic distributed replay protection.** With a `StorageProvider`, `MessageSigner` claims each nonce via `setIfNotExists()` instead of read-then-write, so exactly one verifier across processes sharing that storage accepts a given envelope. v0.5.x's nonce snapshot persistence (`ready`, `flushNoncePersistence()`) is removed. `BeeManager` now passes its `storageProvider` to its signer.
- `SecureAgentMessage.encryptedKey` is replaced by `ephemeralPublicKey` + `encryptionKeyId`. The `EncryptedPayload` export is replaced by `EncryptedEnvelope`.

### ✨ Added
- `BeeKeyring` (owner-held private keys in ECMAScript private fields; automatic, unref'd-timer encryption key rotation; `rotateEncryptionKey()`, `maintain()`, `destroy()`)
- `BeePublicIdentity` type; `sealSecureMessage()`, `openSecureMessage()`, `OpenedMessage`, `signedContent()`, `attestationFingerprint()`, `verifyEncryptionKeySignature()`, `ENCRYPTION_ALGORITHM` exports
- `signingPrivateKey` option on `registerBeeIdentity()` and `Bee`, to load a persistent signing key
- Key-type checks everywhere: an X25519 key is never accepted as an Ed25519 key or vice versa. Low-order X25519 public keys are rejected.

### 📚 Documentation
- docs/SECURITY.md rewritten for the new model: a what-an-attacker-can/cannot-do table by compromise level, and the remaining limitations (shared storage needed for multi-instance replay protection, trust-on-first-use for signing keys, time-bounded forward secrecy, same-process Bees share memory)
- New docs/MIGRATION_0.6.md; HACKING_LAB and README updated

### ✅ Tests
- MessageSigner, MessageEncryption and BeeIdentityManager suites rewritten. New BeeKeyring suite.
- Forward-secrecy test: captured ciphertext becomes undecryptable once its key rotates out, even with the whole keyring stolen. Plus a fresh-ephemeral-keypair-per-`encrypt()` test (counts keypair generation) and a check that the envelope holds only public values.
- Non-repudiation tests: registry lookups carry no private keys, and a key-less forger's signature fails verification.
- `setIfNotExists` contract tests (first-set, no-overwrite, reuse after TTL, one winner among concurrent callers), plus a concurrent cross-verifier replay test
- Security integration: two Bees in separate trust domains exchange signed + encrypted messages using only each other's public keys
- `decryptThenVerify.test.ts`: legitimate messages pass end to end; every envelope field tampered is rejected at decryption with `verify()` never called; forged inner signatures, changed id/nonce/timestamp/sender, unsigned downgrades and replays are rejected after decryption; decrypt always runs before verify. Plus unit tests showing the encrypted envelope exposes no signature and that offline guessing finds nothing to test against.

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
