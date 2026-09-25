# Migrating from v0.5.x to v0.6.0

v0.6.0 is a breaking change to the security layer. There is no
backward-compatible shim: v0.5.x's HMAC-with-shared-secret signing and
static RSA encryption are removed, not deprecated.

If you never enabled `securityOptions.enableSigning` / `enableEncryption`
and never touched `BeeIdentity`, `MessageSigner`, `MessageEncryption` or
`StorageProvider` directly, you only need step 1 (and step 5 if you ship
your own `StorageProvider`).

## What breaks

| Area | v0.5.x | v0.6.0 |
|---|---|---|
| `BeeIdentity` | `{ beeName, publicKey, privateKey, trustScore }` (one RSA-2048 key) | `BeePublicIdentity` `{ beeName, signingPublicKey, encryptionPublicKey, encryptionKeyId, encryptionKeySignature, trustScore }`; `BeeIdentity` adds `signingPrivateKey` + `encryptionPrivateKey`. Keys are base64 DER, not PEM |
| `BeeIdentityManager.registerBeeIdentity(bee, trustScore?)` | Returned the identity; repeat calls returned the same one | `registerBeeIdentity(bee, options?)` returns the private `BeeKeyring`, **once**; registering an existing name throws. `trustScore` moved into `options` |
| `BeeIdentityManager.getBeeIdentity(name)` | Full identity, private key included | `BeePublicIdentity` only (a copy) |
| `BeeIdentityManager.loadIdentity(identity)` | Loaded a full RSA identity | Loads another party's *public* identity; verifies its encryption-key signature, rejects a changed signing key |
| `Bee.getIdentity()` | Full RSA identity | `BeePublicIdentity`. Use `bee.sealMessage()` / `bee.openMessage()` for signing/decryption |
| `MessageSigner.sign(data, identity)` | HMAC with `identity.privateKey` | Ed25519 with `identity.signingPrivateKey` |
| `MessageSigner.verify(data, envelope, identity, options?)` | Sync; needed the full identity (shared secret) | `async verify(data, envelope, senderSigningPublicKey, options?)` returns `Promise<VerificationResult>` |
| `MessageSigner` constructor | `new MessageSigner(storage?)` persisted a nonce snapshot; `ready` / `flushNoncePersistence()` | `new MessageSigner(storage?)` claims nonces with atomic `storage.setIfNotExists()`; `ready` and `flushNoncePersistence()` are gone |
| `MessageEncryption.encrypt(message: string, recipientPublicKey)` | Returned `EncryptedPayload` `{ encrypted, iv, authTag, encryptedKey }` | `encrypt(payload: unknown, recipientEncryptionPublicKey, recipientKeyId)` returns `EncryptedEnvelope` `{ alg, ephemeralPublicKey, recipientKeyId, iv, authTag, ciphertext }` |
| `MessageEncryption.decrypt(payload, privateKey)` | Returned a string | `decrypt(envelope, recipientEncryptionPrivateKey)` returns the original (JSON-round-tripped) payload |
| `SecureAgentMessage` | `encryptedKey` | `ephemeralPublicKey` + `encryptionKeyId` (`iv`/`authTag`/`data` unchanged in role) |
| Signed content in delegations | `data` | `{ id, from, to, data }` (`signedContent(id, from, to, data)`), so a message can't be re-addressed or re-id'd |
| Signature placement | Always in `message.signature` | Signed + encrypted: sealed **inside** the ciphertext (`message.signature` is unset). Signed only: `message.signature`, as before |
| `Bee.openMessage()` / `openSecureMessage()` | (new) | Return `{ data, signature? }`: the plaintext plus the signature recovered from inside the ciphertext |
| Unsigned messages with `enableSigning` | Accepted by `verifyIncomingMessage()` | Rejected |
| `AttestationChain` record for encrypted messages | The signature | `sha256:` digest of the sealed envelope (`attestationFingerprint()`) |
| `BeeManager.verifyIncomingMessage(...)` | Sync, returned `string` | `async`, returns `Promise<string>`; decryption needs the recipient to be a local Bee |
| `StorageProvider` | none | New required method `setIfNotExists(key, value, ttlMs): Promise<boolean>` |
| Exports | `EncryptedPayload` | `EncryptedEnvelope`, `ENCRYPTION_ALGORITHM`, `BeePublicIdentity`, `BeeKeyring`, `sealSecureMessage`, `openSecureMessage`, `OpenedMessage`, `signedContent`, `attestationFingerprint`, `verifyEncryptionKeySignature` |

## Why there's no compatibility shim

Bridging old HMAC-signed or RSA-OAEP-encrypted messages into the new
scheme would mean keeping the old insecure code paths alive, defeating
the purpose of this release. Bhive doesn't persist message envelopes
between releases (delegation history is in memory; persistent queues
store plain task input, not envelopes), so there's nothing to drain.
Regenerate identities and redeploy every process at once. A v0.5 process
and a v0.6 process can't verify or decrypt each other's messages.

Existing `AttestationChain` records keep verifying: the chain hashes each
record's signature string without re-checking it, so pre-0.6 entries
(hex HMACs) and new ones (base64 Ed25519) coexist in one chain.

## Steps

1. **Update** to `@bhive-ai/core@0.6.0`. TypeScript flags every call
   site below, since all the shapes changed.

2. **Identities.** Stop constructing `BeeIdentity` objects by hand or
   reading `.privateKey` / `.publicKey`:
   ```typescript
   // v0.5
   const identity = identityManager.registerBeeIdentity('worker', 0.8);
   identityManager.loadIdentity({ beeName, publicKey, privateKey, trustScore });

   // v0.6
   const keyring = identityManager.registerBeeIdentity('worker', { trustScore: 0.8 });
   // keep `keyring` private to the code that acts as 'worker'
   identityManager.loadIdentity(remotePublicIdentity); // public keys only
   ```
   To keep a stable signing key across restarts, persist
   `keyring.getIdentity().signingPrivateKey` in your secrets manager and
   pass it back as `registerBeeIdentity(name, { signingPrivateKey })` or
   `new Bee(..., { signingPrivateKey })`. Don't persist encryption keys:
   they rotate by design.

3. **Verification.** Pass the sender's signing public key, and `await`:
   ```typescript
   // v0.5
   const result = signer.verify(data, envelope, senderIdentity);

   // v0.6
   const sender = identityManager.getBeeIdentity(senderName)!;
   const result = await signer.verify(data, envelope, sender.signingPublicKey);
   ```
   If you verify `SecureAgentMessage`s yourself, always decrypt first,
   then verify the signature that decryption recovers. For signed +
   encrypted messages there is no signature outside the ciphertext:
   ```typescript
   const opened = recipientBee.openMessage(message); // { data, signature? }
   const result = await signer.verify(
     signedContent(message.id, message.from, message.to, opened.data),
     { signature: opened.signature!, nonce: message.nonce!, timestamp: message.timestamp },
     sender.signingPublicKey
   );
   ```
   Or just call `await beeManager.verifyIncomingMessage(message, from, to)`,
   which does exactly this (now `async`).

4. **Encryption.** Encrypt to the recipient's *current* key and id, and
   decrypt with the key the envelope names:
   ```typescript
   const recipient = identityManager.getBeeIdentity('responder')!;
   const envelope = new MessageEncryption().encrypt(payload, recipient.encryptionPublicKey, recipient.encryptionKeyId);
   ```
   Prefer the higher-level `bee.sealMessage(recipient, data, { sign, encrypt })`
   and `bee.openMessage(message)`, or `sealSecureMessage` /
   `openSecureMessage` with a `BeeKeyring`. They also check that the
   recipient's encryption key is signed by its signing key.

5. **Custom `StorageProvider`s** must implement `setIfNotExists` as a
   single atomic operation:
   - Redis: `SET key value NX PX ttlMs` → `true` if the reply is `OK`
   - SQL: `INSERT ... ON CONFLICT DO NOTHING` (with an expiry column that
     reads and cleanup treat as absent once past) → `true` if a row was
     inserted
   - A read-then-write implementation is **not** acceptable: it
     reintroduces the cross-process replay race this method exists to
     close.

6. **Multi-instance deployments:** give `BeeManager` (or your own
   `MessageSigner`) a *shared* `StorageProvider` so replay protection
   holds across processes. `InMemoryStorage` is per-process.

7. **Tune forward secrecy** if the defaults don't fit (15 min rotation,
   5 min retention): pass `encryptionKeyRotationMs` /
   `encryptionKeyRetentionMs` to `registerBeeIdentity()`. Retention must
   cover your longest expected delivery delay, or late messages become
   undecryptable.

8. **Re-run your test suite.**

See [SECURITY.md](./SECURITY.md) for the new threat model.
