import { randomBytes, sign, verify } from 'crypto';
import { StorageProvider } from '../providers/StorageProvider';
import { BeeIdentity } from '../types';
import { importPrivateKey, importPublicKey } from './keys';

export interface SignedEnvelope {
  /** Base64 Ed25519 signature over the canonical {data, nonce, timestamp}. */
  signature: string;
  nonce: string;
  timestamp: number;
}

export interface VerificationResult {
  valid: boolean;
  reason?: string;
}

const DEFAULT_MAX_AGE_MS = 5 * 60_000; // 5 minutes, per the spec's replay window
const NONCE_KEY_PREFIX = 'bhive:message-signer:nonce:';

/**
 * MessageSigner - Ed25519 message signing and verification with replay
 * protection.
 *
 * Each Bee signs with its own Ed25519 private key (from its BeeKeyring).
 * Anyone with the sender's public key - looked up in BeeIdentityManager's
 * public registry - can verify, without access to any secret. That gives
 * real non-repudiation: a party that only verifies (such as BeeManager)
 * never holds a Bee's private signing key, so it can't forge that Bee's
 * signature. (Within one process, all code shares memory - the guarantee
 * is only as strong as the process boundary between signer and verifier.)
 *
 * Replay protection: a verified nonce is remembered until its envelope's
 * `timestamp + maxAgeMs`, after which the timestamp check rejects the
 * envelope anyway and the nonce is forgotten.
 *
 * - Without a StorageProvider, nonces live in an in-memory Map on this
 *   instance: expired entries are evicted on each verify(), and history
 *   is lost on restart - reopening a replay window of up to `maxAgeMs`
 *   for messages sent just before it - and not shared with other
 *   processes.
 * - With a StorageProvider, each nonce is claimed via the atomic
 *   `setIfNotExists()`, so exactly one verifier across every process
 *   sharing that storage can accept a given envelope. This is only
 *   cross-process-safe if the storage itself is shared (Redis, SQL, ...);
 *   InMemoryStorage is per-process.
 */
export class MessageSigner {
  private seenNonces = new Map<string, number>(); // nonce -> expiresAt

  constructor(private noncePersistence?: StorageProvider) {}

  sign(data: unknown, senderIdentity: Pick<BeeIdentity, 'signingPrivateKey'>): SignedEnvelope {
    const nonce = randomBytes(16).toString('hex');
    const timestamp = Date.now();
    const privateKey = importPrivateKey(senderIdentity.signingPrivateKey, 'ed25519');
    const signature = sign(null, this.canonicalize(data, nonce, timestamp), privateKey).toString('base64');

    return { signature, nonce, timestamp };
  }

  async verify(
    data: unknown,
    envelope: SignedEnvelope,
    senderSigningPublicKey: string,
    options: { maxAgeMs?: number } = {}
  ): Promise<VerificationResult> {
    if (!this.signatureIsValid(data, envelope, senderSigningPublicKey)) {
      return { valid: false, reason: 'Invalid signature' };
    }

    // Timestamp before nonce, so an expired envelope never claims a nonce slot.
    const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    const now = Date.now();
    if (Math.abs(now - envelope.timestamp) > maxAgeMs) {
      return { valid: false, reason: 'Message timestamp is outside the allowed window' };
    }

    // The timestamp check above accepts the envelope until timestamp + maxAgeMs,
    // so the nonce only needs remembering until then.
    const expiresAt = envelope.timestamp + maxAgeMs;
    const firstUse = this.noncePersistence
      ? await this.noncePersistence.setIfNotExists(NONCE_KEY_PREFIX + envelope.nonce, '1', Math.max(expiresAt - now, 1))
      : this.claimNonceInMemory(envelope.nonce, expiresAt, now);

    if (!firstUse) {
      return { valid: false, reason: 'Replay detected: nonce already used' };
    }

    return { valid: true };
  }

  /**
   * Forgets every nonce in this instance's in-memory history. Mostly
   * useful for tests. Nonces claimed in a StorageProvider are not
   * affected - they expire on their own TTL.
   */
  resetNonceHistory(): void {
    this.seenNonces.clear();
  }

  private claimNonceInMemory(nonce: string, expiresAt: number, now: number): boolean {
    for (const [seen, seenExpiresAt] of this.seenNonces) {
      if (seenExpiresAt < now) this.seenNonces.delete(seen);
    }

    if (this.seenNonces.has(nonce)) return false;
    this.seenNonces.set(nonce, expiresAt);
    return true;
  }

  private signatureIsValid(data: unknown, envelope: SignedEnvelope, senderSigningPublicKey: string): boolean {
    try {
      return verify(
        null,
        this.canonicalize(data, envelope.nonce, envelope.timestamp),
        importPublicKey(senderSigningPublicKey, 'ed25519'),
        Buffer.from(envelope.signature, 'base64')
      );
    } catch {
      // Malformed key or signature: treat as a failed verification, never a crash.
      return false;
    }
  }

  private canonicalize(data: unknown, nonce: string, timestamp: number): Buffer {
    return Buffer.from(JSON.stringify({ data, nonce, timestamp }));
  }
}
