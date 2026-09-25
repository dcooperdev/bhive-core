import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { StorageProvider } from '../providers/StorageProvider';
import { BeeIdentity } from '../types';

export interface SignedEnvelope {
  signature: string;
  nonce: string;
  timestamp: number;
}

export interface VerificationResult {
  valid: boolean;
  reason?: string;
}

const DEFAULT_MAX_AGE_MS = 5 * 60_000; // 5 minutes, per the spec's replay window
const NONCE_STORAGE_KEY = 'bhive:message-signer:seen-nonces';

type NonceSnapshot = Array<[nonce: string, expiresAt: number]>;

/**
 * Pending nonce writes per StorageProvider. Shared across MessageSigner
 * instances so two signers on the same storage can't interleave their
 * read-merge-write cycles and drop each other's nonces.
 */
const persistQueues = new WeakMap<StorageProvider, Promise<void>>();

/**
 * MessageSigner - HMAC-SHA256 message signing and verification.
 *
 * Bees within one Hive share a common identity registry (BeeIdentityManager),
 * so a single trusted party (typically BeeManager) can sign on the sender's
 * behalf and verify on the recipient's behalf using the same `privateKey`
 * as the HMAC secret. This gives strong per-message integrity and replay
 * protection within that trust domain; it is not a substitute for
 * asymmetric non-repudiation across separate trust domains.
 *
 * Despite the field name `privateKey` (kept for BeeIdentity compatibility),
 * this value is used here as a symmetric HMAC secret, not an asymmetric
 * private key. See docs/SECURITY.md for the trust model this implies.
 *
 * Replay protection is tracked per MessageSigner instance: once a nonce
 * has been verified, verifying it again fails until the nonce's validity
 * window (`envelope.timestamp + maxAgeMs`) has passed - after which the
 * timestamp check rejects the message anyway, so the nonce is evicted to
 * keep memory bounded.
 *
 * Without a StorageProvider passed to the constructor, nonce history is
 * lost on restart, reopening a replay window of up to `maxAgeMs` for
 * messages sent just before the restart. Pass a persistent StorageProvider
 * in production deployments where this matters. Persisted history is
 * loaded asynchronously; await `ready` before the first `verify()` call
 * so it's in place. Writes are best-effort and asynchronous - `verify()`
 * stays synchronous and never waits on storage. Signers in one process
 * sharing a StorageProvider serialize their writes; separate processes
 * sharing one backend can still race and lose each other's recent nonces.
 */
export class MessageSigner {
  private seenNonces = new Map<string, number>(); // nonce -> expiresAt

  /** Resolves once nonce history has been loaded from `noncePersistence` (immediately if none). */
  readonly ready: Promise<void>;

  constructor(private noncePersistence?: StorageProvider) {
    this.ready = noncePersistence ? this.loadPersistedNonces(noncePersistence) : Promise.resolve();
  }

  sign(data: unknown, identity: BeeIdentity): SignedEnvelope {
    const nonce = randomBytes(16).toString('hex');
    const timestamp = Date.now();
    // Symmetric HMAC secret, not an asymmetric signing key - see class docstring.
    const hmacSecret = identity.privateKey;
    const signature = this.computeHmac(data, nonce, timestamp, hmacSecret);

    return { signature, nonce, timestamp };
  }

  verify(
    data: unknown,
    envelope: SignedEnvelope,
    identity: BeeIdentity,
    options: { maxAgeMs?: number } = {}
  ): VerificationResult {
    // Symmetric HMAC secret, not an asymmetric signing key - see class docstring.
    const hmacSecret = identity.privateKey;
    const expected = this.computeHmac(data, envelope.nonce, envelope.timestamp, hmacSecret);

    if (!this.signaturesMatch(expected, envelope.signature)) {
      return { valid: false, reason: 'Invalid signature' };
    }

    this.evictExpiredNonces(Date.now());

    if (this.seenNonces.has(envelope.nonce)) {
      return { valid: false, reason: 'Replay detected: nonce already used' };
    }

    const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    if (Math.abs(Date.now() - envelope.timestamp) > maxAgeMs) {
      return { valid: false, reason: 'Message timestamp is outside the allowed window' };
    }

    // The timestamp check above accepts the envelope until timestamp + maxAgeMs,
    // so the nonce only needs remembering until then.
    this.seenNonces.set(envelope.nonce, envelope.timestamp + maxAgeMs);
    this.persistNonces();
    return { valid: true };
  }

  /**
   * Forgets every nonce this signer has seen, including any persisted
   * history in `noncePersistence`. Mostly useful for tests.
   */
  resetNonceHistory(): void {
    this.seenNonces.clear();
    const storage = this.noncePersistence;
    if (storage) {
      this.enqueuePersist(storage, () => storage.delete(NONCE_STORAGE_KEY));
    }
  }

  private evictExpiredNonces(now: number): void {
    for (const [nonce, expiresAt] of this.seenNonces) {
      if (expiresAt < now) this.seenNonces.delete(nonce);
    }
  }

  private async loadPersistedNonces(storage: StorageProvider): Promise<void> {
    try {
      const snapshot = await storage.get<NonceSnapshot>(NONCE_STORAGE_KEY);
      const now = Date.now();
      for (const [nonce, expiresAt] of snapshot ?? []) {
        if (expiresAt >= now && !this.seenNonces.has(nonce)) {
          this.seenNonces.set(nonce, expiresAt);
        }
      }
    } catch {
      // Storage unavailable: fall back to in-memory-only replay protection.
    }
  }

  private persistNonces(): void {
    const storage = this.noncePersistence;
    if (!storage) return;

    this.enqueuePersist(storage, async () => {
      // Merge with whatever is stored so signers sharing the same storage
      // don't drop each other's nonces, then keep only unexpired entries.
      const now = Date.now();
      const merged = new Map(await storage.get<NonceSnapshot>(NONCE_STORAGE_KEY) ?? []);
      for (const [nonce, expiresAt] of this.seenNonces) merged.set(nonce, expiresAt);

      const snapshot: NonceSnapshot = [...merged].filter(([, expiresAt]) => expiresAt >= now);
      if (snapshot.length === 0) {
        await storage.delete(NONCE_STORAGE_KEY);
        return;
      }

      const latestExpiry = Math.max(...snapshot.map(([, expiresAt]) => expiresAt));
      await storage.set(NONCE_STORAGE_KEY, snapshot, Math.max(latestExpiry - now, 1));
    });
  }

  /** Serializes writes per storage so an older snapshot can never overwrite a newer one. */
  private enqueuePersist(storage: StorageProvider, write: () => Promise<void>): void {
    const queued = (persistQueues.get(storage) ?? Promise.resolve())
      .then(write)
      .catch(() => {
        // Best-effort: a failed write only weakens restart protection, never verification itself.
      });
    persistQueues.set(storage, queued);
  }

  /** @internal Resolves once every queued nonce write to `noncePersistence` has settled. */
  flushNoncePersistence(): Promise<void> {
    return (this.noncePersistence && persistQueues.get(this.noncePersistence)) || Promise.resolve();
  }

  private computeHmac(data: unknown, nonce: string, timestamp: number, hmacSecret: string): string {
    const canonical = JSON.stringify({ data, nonce, timestamp });
    // `hmacSecret` is BeeIdentity.privateKey used as a symmetric HMAC secret,
    // not as an asymmetric private key. See docs/SECURITY.md for the trust model.
    return createHmac('sha256', hmacSecret).update(canonical).digest('hex');
  }

  private signaturesMatch(expectedHex: string, actualHex: string): boolean {
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = Buffer.from(actualHex, 'hex');

    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  }
}
