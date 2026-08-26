import { generateKeyPairSync } from 'crypto';
import { BeeIdentity } from '../types';
import type { Bee } from './Bee';

const RSA_MODULUS_LENGTH = 2048;

/**
 * BeeIdentityManager - generates and stores RSA-2048 identities for Bees.
 *
 * All Bees that need to sign/encrypt/verify messages to each other must
 * share the same BeeIdentityManager instance (BeeManager owns one and
 * passes it to every Bee it creates) - it's the trust root that lets a
 * recipient look up a sender's key material and vice versa.
 *
 * Not a hard singleton: tests and multi-tenant setups can each construct
 * their own instance. `getDefaultBeeIdentityManager()` below provides a
 * convenient shared instance for callers that don't need isolation.
 */
export class BeeIdentityManager {
  private identities = new Map<string, BeeIdentity>();

  /**
   * Generates (or returns the existing) identity for a Bee. Accepts
   * either a Bee instance or a plain name so it can be used both from
   * BeeManager.createBee() and directly in tests/scripts.
   */
  registerBeeIdentity(bee: Bee | string, trustScore = 1): BeeIdentity {
    const beeName = typeof bee === 'string' ? bee : bee.getName();

    const existing = this.identities.get(beeName);
    if (existing) return existing;

    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: RSA_MODULUS_LENGTH,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    const identity: BeeIdentity = { beeName, publicKey, privateKey, trustScore };
    this.identities.set(beeName, identity);

    return identity;
  }

  getBeeIdentity(beeName: string): BeeIdentity | undefined {
    return this.identities.get(beeName);
  }

  hasIdentity(beeName: string): boolean {
    return this.identities.has(beeName);
  }

  /** Loads a pre-existing identity (e.g. from environment/storage) instead of generating a new keypair. */
  loadIdentity(identity: BeeIdentity): void {
    this.identities.set(identity.beeName, identity);
  }

  removeIdentity(beeName: string): void {
    this.identities.delete(beeName);
  }

  listIdentities(): string[] {
    return Array.from(this.identities.keys());
  }
}

let defaultInstance: BeeIdentityManager | undefined;

/** A shared BeeIdentityManager for callers that don't need an isolated instance. */
export function getDefaultBeeIdentityManager(): BeeIdentityManager {
  if (!defaultInstance) {
    defaultInstance = new BeeIdentityManager();
  }
  return defaultInstance;
}
