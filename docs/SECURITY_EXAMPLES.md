# Security Examples

Runnable-shaped examples for each piece of Hive's secure agent
communication protocol. See [docs/SECURITY.md](./SECURITY.md) for the
threat model behind each one.

## Setting up secure delegation

Signing and encryption are both opt-in per `BeeManager`, and apply to
every delegation that manager coordinates:

```typescript
import { BeeManager, createDelegationTool } from 'bhive';

const beeManager = new BeeManager('gemini-1.5-flash', {
  apiKey: process.env.GOOGLE_API_KEY,
  securityOptions: {
    enableSigning: true,
    enableEncryption: true
  }
});

beeManager.createBee({
  name: 'classifier',
  prompt: 'Classify the email, then delegate drafting a reply to the responder agent.',
  tools: [classifyTool, createDelegationTool('responder', 'Delegate email response')]
});

beeManager.createBee({
  name: 'responder',
  prompt: 'Draft a professional reply.',
  tools: []
});

const result = await beeManager.getBee('classifier')!.run('Process email: ...');

// Every hop is now signed and encrypted:
const [delegation] = beeManager.getDelegationHistory();
console.log(delegation.secureMessage?.signature, delegation.secureMessage?.encrypted);
```

Nothing else changes in how you build or call your Bees - the
signing/encryption/attestation pipeline runs transparently inside
`delegateToAgent()`.

## Configuring per-Bee security context

```typescript
import { BeeManager, BeeSecurityContext } from 'bhive';

const beeManager = new BeeManager('gemini-1.5-flash', { apiKey: process.env.GOOGLE_API_KEY });

// Shorthand: trustLevel + allowedDelegates.
beeManager.createBee({
  name: 'classifier',
  prompt: '...',
  tools: [classifyTool, createDelegationTool('responder')],
  trustLevel: 'careful',
  allowedDelegates: ['responder'] // delegating anywhere else throws
});

// Full control: a BeeSecurityContext with rate limiting, message size caps, and a tool whitelist too.
beeManager.createBee({
  name: 'untrusted-input-handler',
  prompt: 'Summarize incoming support tickets.',
  tools: [summarizeTool, createDelegationTool('triager')],
  securityContext: new BeeSecurityContext({
    trustLevel: 'careful',
    allowedDelegates: ['triager'],
    maxMessagesPerMinute: 30,
    maxMessageSize: 50_000, // 50KB
    allowedTools: ['summarize_ticket'] // "delegate_to_triager" is still allowed - it's a Tool, checked separately if you wire isToolAllowed() in
  })
});
```

See [docs/TRUST.md](./TRUST.md) for the full trust-level reference.

## Detecting prompt injection

Every `Bee.run()` call scans its input automatically - you don't need
to call the detector yourself for that. But it's a plain class you can
use directly wherever else you handle untrusted text (e.g. before
storing it, or before it reaches a different LLM call entirely):

```typescript
import { PromptInjectionDetector } from 'bhive';

const detector = new PromptInjectionDetector();

const result = detector.detectInjection(userSuppliedText);
// { original, sanitized, injectionRisk: 0-1, patterns: string[] }

if (result.injectionRisk > 0.7) {
  // detectInjection() already logs a warning at this threshold; add
  // your own alerting/blocking here if you want to reject outright
  // instead of just sanitizing.
  await notifySecurityTeam(result);
}

llm.complete([{ role: 'user', content: result.sanitized }]);
```

Inside `Bee`, every run also publishes a `security:injection_detected`
event and (when the Bee has an `auditLog`) records an `injection_detected`
audit entry whenever any pattern matches - regardless of risk score.

## Verifying attestation chains

```typescript
import { AttestationChainService, verifyAttestationChain } from 'bhive';

// Via BeeManager, once signing/encryption is enabled:
const chain = await beeManager.getAttestationChain();
await beeManager.verifyAttestationChain(); // throws on the first broken/tampered link, otherwise resolves true

// Standalone, e.g. auditing a chain exported from storage:
verifyAttestationChain(exportedChain); // same contract: throws or returns true
```

`verifyAttestationChain` throws with a message naming exactly which
`messageId` broke the chain and why (`previousHash` mismatch = a link
was removed/reordered; hash mismatch = a record's content was altered
without recomputing its hash - i.e. tampering).

## mTLS configuration

```typescript
import { loadMTLSConfigFromEnv, loadMTLSConfigFromFiles, validateCertificateChain, toRedisTLSOptions } from 'bhive';

// From environment variables (HIVE_MTLS_CA/CERT/KEY holding PEM content):
const fromEnv = loadMTLSConfigFromEnv();

// From files on disk:
const fromFiles = loadMTLSConfigFromFiles({
  ca: '/etc/hive/certs/ca.pem',
  cert: '/etc/hive/certs/client-cert.pem',
  key: '/etc/hive/certs/client-key.pem'
});

const mtls = fromEnv ?? fromFiles;

const check = validateCertificateChain(mtls);
if (!check.valid) throw new Error(`Bad mTLS config: ${check.reason}`);

// Hand it to whatever Redis/Kafka/WebSocket client backs your StorageProvider/EventBus:
const redis = createClient({ socket: { tls: true, ...toRedisTLSOptions(mtls) } });
```

## Reading the audit trail

```typescript
const auditLog = beeManager.getAuditLog();

// Everything one Bee did or had done to it, most recent last:
await auditLog.getAuditHistory('classifier', 100);

// Every unauthorized delegation attempt across the whole Hive:
await auditLog.getEntriesByType('unauthorized_delegation');

// Full export, e.g. to ship to a SIEM:
const trailJson = await auditLog.exportAuditTrail();
```
