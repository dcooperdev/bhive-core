import { BeePublicIdentity } from '../types';
import { verifyEncryptionKeySignature } from '../security/keys';
import { BeeKeyring, BeeKeyringOptions } from './BeeKeyring';
import type { Bee } from './Bee';

export type RegisterIdentityOptions = Omit<BeeKeyringOptions, 'onRotate'>;

/**
 * BeeIdentityManager - the public-key registry for a Hive.
 *
 * It stores only *public* identities (Ed25519 signing key + current
 * X25519 encryption key): enough for any party to verify a Bee's
 * signatures or encrypt to it, never enough to impersonate it or read
 * its mail. Private keys live in each Bee's BeeKeyring, which
 * `registerBeeIdentity()` hands to the registering caller exactly once.
 * A name can't be registered twice, so no one can obtain a second
 * keyring for an existing Bee.
 *
 * Not a hard singleton: tests and multi-tenant setups can each construct
 * their own instance. `getDefaultBeeIdentityManager()` below provides a
 * convenient shared instance for callers that don't need isolation.
 */
export class BeeIdentityManager {
  private identities = new Map<string, BeePublicIdentity>();

  /**
   * Generates Ed25519 signing + X25519 encryption keys for a new Bee,
   * publishes its public identity, and returns the private keyring to the
   * caller - the only time it is ever handed out. Accepts either a Bee
   * instance or a plain name. Throws if the name is already registered.
   */
  registerBeeIdentity(bee: Bee | string, options: RegisterIdentityOptions = {}): BeeKeyring {
    const beeName = typeof bee === 'string' ? bee : bee.getName();

    if (this.identities.has(beeName)) {
      throw new Error(`An identity is already registered for "${beeName}"; its keys belong to whoever registered it first`);
    }

    const keyring = new BeeKeyring(beeName, {
      ...options,
      onRotate: identity => {
        // Ignore rotations from a keyring whose identity was since removed or replaced.
        if (this.identities.get(beeName)?.signingPublicKey === identity.signingPublicKey) {
          this.identities.set(beeName, identity);
        }
      }
    });
    this.identities.set(beeName, keyring.getPublicIdentity());

    return keyring;
  }

  /** The public identity of any registered Bee. Never contains private keys. */
  getBeeIdentity(beeName: string): BeePublicIdentity | undefined {
    const identity = this.identities.get(beeName);
    return identity ? { ...identity } : undefined;
  }

  hasIdentity(beeName: string): boolean {
    return this.identities.has(beeName);
  }

  /**
   * Registers (or updates) a Bee whose keys are held elsewhere, e.g. in
   * another process. Public keys only. Rejects an identity whose
   * encryption key isn't signed by its own signing key, and rejects a
   * signing-key change for an already-known Bee (remove it first to
   * deliberately re-key).
   */
  loadIdentity(identity: BeePublicIdentity): void {
    if (!verifyEncryptionKeySignature(identity)) {
      throw new Error(`Identity for "${identity.beeName}" has an encryption key not signed by its signing key`);
    }

    const existing = this.identities.get(identity.beeName);
    if (existing && existing.signingPublicKey !== identity.signingPublicKey) {
      throw new Error(`Identity for "${identity.beeName}" has a different signing key; call removeIdentity() first to re-key`);
    }

    this.identities.set(identity.beeName, {
      beeName: identity.beeName,
      signingPublicKey: identity.signingPublicKey,
      encryptionPublicKey: identity.encryptionPublicKey,
      encryptionKeyId: identity.encryptionKeyId,
      encryptionKeySignature: identity.encryptionKeySignature,
      trustScore: identity.trustScore
    });
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
