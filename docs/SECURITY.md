# Security Guide

Hive's secure agent-to-agent protocol (introduced in v0.4.0, redesigned
in v0.6.0) sits on top of the delegation system. Every piece is opt-in:
a Hive with no security configuration delegates plain text.

v0.6.0 replaced the v0.5.x model (HMAC with a shared secret, static
RSA-OAEP, one RSA key doing both jobs). See
[MIGRATION_0.6.md](./MIGRATION_0.6.md) for upgrading.

## Cryptographic model

| Purpose | Primitive | Key |
|---|---|---|
| Signing | Ed25519 | Each Bee's long-lived signing keypair |
| Encryption | Ephemeral X25519 ECDH → HKDF-SHA256 → AES-256-GCM | A fresh sender keypair per message, plus the recipient's *rotating* X25519 encryption key |
| Replay protection | Random 128-bit nonce + timestamp window, nonce claimed atomically | `StorageProvider.setIfNotExists()`, or an in-memory map |
| Provenance | SHA-256 hash chain (`AttestationChain`) + `AuditLog` | none |

**Who holds what.** Each Bee owns a `BeeKeyring` with its private keys.
`BeeIdentityManager` is a *public-key* registry: lookups return
`BeePublicIdentity` (signing public key, current encryption public key,
and that key's signature), never private keys. `BeeManager` only
*verifies* signatures with public keys. It asks the sending Bee to sign
(`Bee.sealMessage()`) and the receiving Bee to decrypt
(`Bee.openMessage()`), and never handles either Bee's private keys.
Signing and encryption use separate keypairs, so a party able to verify
a Bee's signatures has no way to read its mail.

## Message format and verification order

A signature always covers `{ id, from, to, data }` (the plaintext) plus
the nonce and timestamp. Where it travels depends on what's enabled:

| Mode | On the wire | Receiver does |
|---|---|---|
| **Signed + encrypted** | `ciphertext` = AES-GCM of `{ data, signature }`; `iv`, `authTag`, `ephemeralPublicKey`, `encryptionKeyId`; `id`, `from`, `to`, `nonce`, `timestamp` in the clear. **No signature outside the ciphertext.** | 1. Decrypt. 2. Verify the recovered signature |
| **Signed only** (unchanged) | `data`, `signature`, `nonce`, `timestamp` in the clear | Verify |
| **Encrypted only** | `ciphertext` = AES-GCM of `{ data }` | Decrypt |

**Decrypt-then-verify.** For signed + encrypted messages the signature is
sealed inside the encrypted envelope, so `BeeManager.verifyIncomingMessage()`
always runs in this order, and there is no path that verifies first:

1. **Decrypt** with the recipient Bee's own key (`Bee.openMessage()`).
   AES-GCM authenticates the ciphertext, IV, tag and header (algorithm,
   ephemeral key, key id, bound as additional data), so *any* tampering
   with the envelope is rejected here, before a signature is looked at.
   An encrypted message that also carries a signature outside the
   ciphertext is rejected too.
2. **Verify** the Ed25519 signature recovered from the plaintext over
   `{ id, from, to, data }` + nonce + timestamp, with the sender's public
   key, then claim the nonce (replay check).

Why the signature must be inside: a signature over the plaintext is
checkable by anyone with the sender's public key. Left in the clear next
to the ciphertext, it would let an eavesdropper confirm guesses of a
low-entropy payload offline ("is it `approve`?") without breaking the
encryption. Inside the ciphertext, only the recipient ever sees it.

**Why step 2 can't be skipped.** GCM proves a message was encrypted *to*
the recipient, not *by* whom: anyone can encrypt to a public key. So a
message that decrypts cleanly proves nothing about its sender. With
`securityOptions.enableSigning`, a message without a signature (outside,
or inside the ciphertext) is rejected as a downgrade attempt.

**Attestation.** `AttestationChain` records a signed-only message's
signature, but for encrypted messages it records a SHA-256 digest of the
sealed envelope (`sha256:...`, see `attestationFingerprint()`). Storing
the signature there would expose it again.

## Threat model

Hive coordinates autonomous LLM-driven agents that can hand tasks to
each other over shared infrastructure (Redis, Kafka, a message bus) that
isn't necessarily trusted end-to-end.

### What an attacker can and cannot do, by compromise level

| Attacker has... | Can | Cannot |
|---|---|---|
| **Network / transport access** (reads and writes the message bus, logs, a packet capture) | See metadata (`from`, `to`, timestamps, sizes); drop or delay messages; resubmit captured envelopes | Read encrypted payloads; modify a signed message undetected; re-address, re-attribute or re-id a signed message (the signature covers `id`, `from` and `to`); confirm guesses about an encrypted payload (the signature is sealed inside the ciphertext); get a replay accepted by a verifier that already saw it, or by *any* verifier sharing a `setIfNotExists`-backed store |
| **A verifier or registry, e.g. a compromised `BeeManager`** that only holds public keys (the cross-process deployment) | Refuse or drop messages; lie about what it verified; hand out a *signing* public key it controls for a Bee it has never seen (trust-on-first-use, see below) | Forge a signature from any Bee: it never holds a private signing key. Substitute a Bee's encryption key: senders check it's signed by the Bee's signing key (`verifyEncryptionKeySignature`). Decrypt messages to a Bee |
| **One Bee's private keys** (its `BeeKeyring`), stolen at time T | Sign as that Bee from T onward; decrypt messages to that Bee that are encrypted to keys it still holds at T, i.e. traffic from roughly the last `encryptionKeyRotationMs + encryptionKeyRetentionMs` (20 minutes by default), plus new messages until it's re-keyed | Decrypt older captured traffic: those encryption keys were rotated out and **deleted**, so no one can recover them (forward secrecy). Sign as, or decrypt for, any *other* Bee |
| **The process running every Bee** (single-process deployment) | Everything: every keyring is in that process's memory | Nothing is protected from code running in the same process. Non-repudiation between Bees needs process boundaries between them |

**Compromising BeeManager no longer allows forging Bee signatures,** because
BeeManager never holds any Bee's private signing key. This holds when Bees
run in separate processes from the verifier. In one process, all code
shares memory, so the guarantee is only as strong as that process.

**Compromising a Bee's encryption private key does not expose past
captured traffic older than its retention window** (forward secrecy).
Each message is encrypted with a key derived from a fresh ephemeral
X25519 keypair and the recipient's *current* encryption key. ECDH is
symmetric, so the recipient's key alone recovers any message encrypted
to it. That's why forward secrecy comes from rotating those keys and
deleting the old ones (`BeeKeyring`): once a key is deleted, messages
encrypted to it can't be decrypted by anyone. The sender's ephemeral
private key is discarded inside `encrypt()`, so nothing on the sender
side can decrypt either.

### Threats and mitigations

| Threat | What it looks like | Mitigation |
|---|---|---|
| **Interception** | An attacker with read access to the transport reads a delegated task | `MessageEncryption`: only the recipient's current (or recently retained) X25519 private key can decrypt |
| **Tampering** | An attacker with write access modifies a message in flight | AES-GCM authentication of the whole encrypted envelope (header bound as additional data), checked first; then Ed25519 signatures (`MessageSigner`) over `{id, from, to, data}` plus nonce and timestamp |
| **Content guessing** | An eavesdropper tests candidate plaintexts against a visible signature | For encrypted messages the signature is sealed inside the ciphertext, so there's nothing on the wire to test against |
| **Unsigned downgrade** | An attacker encrypts its own unsigned message to a Bee's public key | With `enableSigning`, unsigned messages are rejected after decryption |
| **Forgery / repudiation** | "Bee X sent this": can anyone but X have produced it? | Only X's `BeeKeyring` holds X's Ed25519 private key; verifiers hold public keys only |
| **Replay** | An attacker resubmits a validly signed message | Timestamp window (`maxAgeMs`, default 5 min) plus a nonce accepted only once, claimed atomically with `StorageProvider.setIfNotExists()` when configured |
| **Key substitution** | A registry or hop swaps in an encryption key it controls | Each encryption key is signed by the Bee's signing key; `loadIdentity()` and `sealSecureMessage()` reject unsigned keys |
| **Prompt injection** | Untrusted input tries to override an agent's instructions | `PromptInjectionDetector` scans and redacts known patterns before the text reaches any LLM |
| **Privilege escalation via delegation** | An agent tries to delegate to an agent it shouldn't reach | `BeeSecurityContext` whitelisting (`trustLevel: 'careful'`/`'strict'`), enforced both at the Bee and the BeeManager |
| **Unclear provenance** | "Was the chain ever broken?" | `AttestationChain` (SHA-256 hash chain over every signed message) and `AuditLog` |

**Not** in scope: transport-layer confidentiality when you don't
configure encryption (plain Redis is still plain), metadata privacy
(`from`/`to`/timing are visible), and full X.509 chain-of-trust
validation for mTLS (that happens in the TLS layer of whichever client
you connect with).

## Remaining limitations

- **Replay protection is only cross-process-safe with shared storage.**
  With a `StorageProvider`, `MessageSigner` claims each nonce with the
  atomic `setIfNotExists()`, so exactly one verifier accepts a given
  envelope. This only helps across processes if the storage is actually
  shared: Redis (`SET key value NX PX ttl`) or SQL (`INSERT ... ON
  CONFLICT DO NOTHING`). `InMemoryStorage` is per-process. Without a
  `StorageProvider`, nonces are kept in memory: bounded, but lost on
  restart (reopening a replay window of up to `maxAgeMs` for messages
  sent just before it) and not shared between instances. **Multi-instance
  deployments must configure a shared `StorageProvider` that implements
  `setIfNotExists` atomically.** `BeeManager` passes its own
  `storageProvider` to its signer automatically.
- **Trust on first use for signing keys.** Nothing in Hive certifies that
  a signing public key belongs to the Bee name it's registered under.
  `BeeIdentityManager` refuses to replace a known Bee's signing key
  (`removeIdentity()` first to re-key deliberately), but whoever
  introduces a Bee's public identity the first time is trusted. Distribute
  public identities over an authenticated channel.
- **Forward secrecy is time-bounded, not per-message.** A stolen keyring
  exposes messages encrypted to its still-held keys, up to about
  `encryptionKeyRotationMs + encryptionKeyRetentionMs` of traffic. Lower
  both via `registerBeeIdentity(name, options)` to shrink that window.
  The trade-off: a message that arrives after its key's retention window
  can't be decrypted. JavaScript can't zeroize memory, so deleted keys
  are dropped for garbage collection rather than wiped.
- **Same-process Bees share memory.** See the last row of the table above.

## Key management

- `BeeIdentityManager.registerBeeIdentity(bee, options?)` generates an
  Ed25519 signing keypair and an X25519 encryption keypair. It publishes
  the public identity and returns the private `BeeKeyring` to the caller,
  exactly once. Registering an existing name throws, so no one can obtain
  a second keyring for an existing Bee. `Bee` does this itself on
  construction and keeps its keyring private.
- `BeeManager` owns one `BeeIdentityManager` and passes it to every Bee
  it creates via `createBee()`. A Bee constructed directly gets its own
  registry and can't be addressed by other Bees' secure messages.
- Keys are base64 DER (SPKI public, PKCS#8 private), and each import
  checks the algorithm, so an X25519 key is never accepted where an
  Ed25519 key is expected, or vice versa.
- **Encryption key rotation** is automatic: every
  `encryptionKeyRotationMs` (default 15 min) a Bee generates a new X25519
  key, signs it, and publishes it to the registry. The replaced key is
  kept for `encryptionKeyRetentionMs` (default 5 min, matching the replay
  window) for in-flight messages, then deleted. `keyring.rotateEncryptionKey()`
  rotates immediately.
- **Loading a persistent signing key** (e.g. from a secrets manager):
  `registerBeeIdentity(name, { signingPrivateKey })`, or
  `new Bee(..., { signingPrivateKey })`. Encryption keys are always
  generated fresh, since they're meant to be short-lived.
- **Bees in other processes:** exchange `BeePublicIdentity` objects and
  register them with `identityManager.loadIdentity(identity)`. That
  verifies the encryption key's signature and refuses a changed signing
  key for a known Bee.
- **Re-keying a Bee's signing key:** `removeIdentity(name)`, then register
  again. In-flight messages signed with the old key will fail
  verification, as intended.
- **Non-Bee senders** (e.g. `delegateToAgent('system', ...)`): `BeeManager`
  registers a keyring for that name and signs as it. Here BeeManager
  itself is the sender, so it legitimately owns those keys. It refuses to
  sign as any name whose identity is held by someone else.

## Enabling the protocol

```typescript
import { BeeManager } from '@bhive-ai/core';

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
a small CPU cost per delegation (an Ed25519 signature, and an X25519
keypair plus ECDH per encrypted message), so they're off by default.

## mTLS setup

For securing the *transport* to a real backend (Redis, Kafka, a
WebSocket EventBus) rather than the agent-to-agent payload itself:

```typescript
import { loadMTLSConfigFromFiles, toRedisTLSOptions } from '@bhive-ai/core';

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
import { loadMTLSConfigFromEnv } from '@bhive-ai/core';

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
