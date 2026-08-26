# Security Guide

Hive v0.4.0 adds a secure agent-to-agent communication protocol on top of
the delegation system from v0.3. Every piece is optional and additive:
a Hive with no security configuration behaves exactly like v0.3.

## Threat model

Hive coordinates autonomous LLM-driven agents that can hand tasks to
each other and, depending on your providers, communicate over shared
infrastructure (Redis, Kafka, a message bus) that isn't necessarily
trusted end-to-end. The protocol in this release specifically defends
against:

| Threat | What it looks like | Mitigation |
|---|---|---|
| **Interception** | An attacker with read access to the transport (Redis, a log, a network tap) reads a delegated task | End-to-end hybrid encryption (`MessageEncryption`) - only the recipient's RSA private key can unwrap the message |
| **Tampering** | An attacker with write access to the transport modifies a message in flight | HMAC-SHA256 signing (`MessageSigner`) - any change to the payload invalidates the signature |
| **Replay** | An attacker resubmits a previously-intercepted, validly-signed message | Nonce tracking in `MessageSigner.verify()` - a nonce is only ever accepted once |
| **Prompt injection** | Untrusted input tries to override an agent's instructions ("ignore all previous instructions...") | `PromptInjectionDetector` scans and redacts known patterns before the text reaches any LLM |
| **Privilege escalation via delegation** | A compromised or misconfigured agent tries to delegate to an agent it shouldn't reach | `BeeSecurityContext` whitelisting (`trustLevel: 'careful'`/`'strict'`), enforced both at the Bee and the BeeManager |
| **Repudiation / unclear provenance** | "Who actually sent this, and was the chain ever broken?" | `AttestationChain` - a SHA-256 hash chain over every signed message; `AuditLog` - a full record of every security-relevant event |

**Not** in scope for this release: transport-layer confidentiality when
you don't configure encryption (plain HTTP/unencrypted Redis is still
plain), and full X.509 chain-of-trust validation for mTLS (see
[Trust boundary](#trust-boundary-of-hmac-signing) below and the mTLS
section - that validation happens in the TLS layer of whichever client
you connect with, not in Hive itself).

## Trust boundary of HMAC signing

`MessageSigner` uses HMAC-SHA256, keyed by the sender's `privateKey`. HMAC
is a *symmetric* MAC - the recipient can only verify a signature if it
has access to the same key material the sender used. This is a
deliberate design choice: Hive assumes every Bee within one
`BeeManager`'s `BeeIdentityManager` is part of one trust domain (one
Hive deployment, whether that's one process or several instances
sharing state), so a single trusted party (the manager verifying on the
recipient's behalf) can look up any registered Bee's key material.

This gives strong per-message integrity and replay protection *within*
that trust domain. It is **not** asymmetric non-repudiation across
separate trust domains - if you need "any third party can verify this
came from Bee X, without access to Bee X's private key," swap in an
RSA-PSS or ECDSA `LLMAdapter`-style adapter implementing the same
sign/verify shape (see [docs/PROVIDERS.md](./PROVIDERS.md) for the
adapter pattern this project uses everywhere else).

`MessageEncryption`, by contrast, *is* fully asymmetric: RSA-2048-OAEP
wraps a random AES-256 key, so only the holder of the matching RSA
private key can ever decrypt - not even the sender can decrypt their
own outbound message after the fact.

## Key management

- `BeeIdentityManager.registerBeeIdentity(bee)` generates an RSA-2048
  keypair (SPKI/PKCS8 PEM) the first time a Bee name is seen, and
  returns the existing identity on every call after that.
- `BeeManager` owns one `BeeIdentityManager` and passes it to every Bee
  it creates via `createBee()` - this is what lets Bees within one Hive
  verify/encrypt to each other. A Bee constructed directly (bypassing
  `BeeManager`) gets its own private identity manager and can't be
  addressed by other Bees' secure messages.
- Private keys never leave the `BeeIdentityManager` instance that
  generated them; `SecureAgentMessage`/audit log entries never carry a
  `privateKey`.
- To load existing keys instead of generating new ones (e.g. from a
  secrets manager on startup), use `identityManager.loadIdentity({ beeName, publicKey, privateKey, trustScore })`.
- Rotating a key: call `loadIdentity()` again with the new keypair for
  that `beeName`. In-flight signed messages using the old key will fail
  verification after rotation - that's intended.

## Enabling the protocol

```typescript
import { BeeManager } from '@bhive/core';

const beeManager = new BeeManager('gemini-1.5-flash', {
  apiKey: process.env.GOOGLE_API_KEY,
  securityOptions: {
    enableSigning: true,
    enableEncryption: true,
    trustLevel: 'careful' // manager-wide default; overridable per-Bee
  }
});
```

See [docs/SECURITY_EXAMPLES.md](./SECURITY_EXAMPLES.md) for complete,
runnable-shaped examples of every piece below, and
[docs/HACKING_LAB.md](./HACKING_LAB.md) to see each mitigation actually
defeat the attack it's designed for.

## What runs on every delegation, regardless of configuration

Even with `securityOptions` entirely omitted, every call to
`BeeManager.delegateToAgent()` (used by `Bee.delegateTo()` and by
`createDelegationTool()`-based tools):

1. Checks the sender's `BeeSecurityContext` (delegation whitelist + rate limit) - permissive by default, so this is a no-op unless you configure it.
2. Scans the task for prompt-injection patterns and uses the sanitized version downstream.
3. Records `message_sent` / `message_received` (and any failures) to the `AuditLog`.
4. Publishes `delegation:start` / `delegation:complete` / `delegation:error` (or `delegation:security_error` for a security-specific failure) through the configured `EventPublisher`.

Signing, encryption, and attestation are the only genuinely opt-in
pieces (`securityOptions.enableSigning` / `enableEncryption`) - they add
real CPU cost (RSA-2048 operations) per delegation, so they're off by
default.

## mTLS setup

For securing the *transport* to a real backend (Redis, Kafka, a
WebSocket EventBus) rather than the agent-to-agent payload itself:

```typescript
import { loadMTLSConfigFromFiles, toRedisTLSOptions } from '@bhive/core';

const mtls = loadMTLSConfigFromFiles({
  ca: '/etc/hive/certs/ca.pem',
  cert: '/etc/hive/certs/client-cert.pem',
  key: '/etc/hive/certs/client-key.pem'
});

const redisClient = createClient({ socket: { tls: true, ...toRedisTLSOptions(mtls) } });
```

Or from environment variables holding PEM content directly
(`HIVE_MTLS_CA`, `HIVE_MTLS_CERT`, `HIVE_MTLS_KEY`, optionally
`HIVE_MTLS_REJECT_UNAUTHORIZED=false` for local development only):

```typescript
import { loadMTLSConfigFromEnv } from '@bhive/core';

const mtls = loadMTLSConfigFromEnv(); // undefined if any of the three are missing
```

`validateCertificateChain(mtls)` does a structural PEM sanity check
before you hand credentials to a client library - it is **not** a
substitute for that library's own TLS handshake validation, which is
where the actual cryptographic chain-of-trust check happens.

## Audit trail

```typescript
const auditLog = beeManager.getAuditLog();

await auditLog.getAuditHistory('classifier', 50); // last 50 events for one Bee
await auditLog.getEntriesByType('unauthorized_delegation');
await auditLog.exportAuditTrail(); // full trail as JSON, for archival/SIEM ingestion
```

Pass a `StorageProvider` (directly, or implicitly via `BeeManager`'s own
`storageProvider`) to persist the trail durably instead of losing it on
process restart.
