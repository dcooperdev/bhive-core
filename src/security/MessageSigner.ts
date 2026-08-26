import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
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

/**
 * MessageSigner - HMAC-SHA256 message signing and verification.
 *
 * Bees within one Hive share a common identity registry (BeeIdentityManager),
 * so a single trusted party (typically BeeManager) can sign on the sender's
 * behalf and verify on the recipient's behalf using the same `privateKey`
 * as the HMAC secret. This gives strong per-message integrity and replay
 * protection within that trust domain; it is not a substitute for
 * asymmetric non-repudiation across separate trust domains (see
 * docs/SECURITY.md).
 *
 * Replay protection is tracked per MessageSigner instance: once a nonce
 * has been verified, verifying it again always fails.
 */
export class MessageSigner {
  private seenNonces = new Set<string>();

  sign(data: unknown, identity: BeeIdentity): SignedEnvelope {
    const nonce = randomBytes(16).toString('hex');
    const timestamp = Date.now();
    const signature = this.computeHmac(data, nonce, timestamp, identity.privateKey);

    return { signature, nonce, timestamp };
  }

  verify(
    data: unknown,
    envelope: SignedEnvelope,
    identity: BeeIdentity,
    options: { maxAgeMs?: number } = {}
  ): VerificationResult {
    const expected = this.computeHmac(data, envelope.nonce, envelope.timestamp, identity.privateKey);

    if (!this.signaturesMatch(expected, envelope.signature)) {
      return { valid: false, reason: 'Invalid signature' };
    }

    if (this.seenNonces.has(envelope.nonce)) {
      return { valid: false, reason: 'Replay detected: nonce already used' };
    }

    const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    if (Math.abs(Date.now() - envelope.timestamp) > maxAgeMs) {
      return { valid: false, reason: 'Message timestamp is outside the allowed window' };
    }

    this.seenNonces.add(envelope.nonce);
    return { valid: true };
  }

  /** Forgets every nonce this signer has seen. Mostly useful for tests. */
  resetNonceHistory(): void {
    this.seenNonces.clear();
  }

  private computeHmac(data: unknown, nonce: string, timestamp: number, secret: string): string {
    const canonical = JSON.stringify({ data, nonce, timestamp });
    return createHmac('sha256', secret).update(canonical).digest('hex');
  }

  private signaturesMatch(expectedHex: string, actualHex: string): boolean {
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = Buffer.from(actualHex, 'hex');

    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  }
}
