import { createPublicKey, generateKeyPairSync, KeyObject, randomBytes } from 'crypto';
import { BeeIdentity, BeePublicIdentity } from '../types';
import {
  exportPrivateKey,
  exportPublicKey,
  importPrivateKey,
  signEncryptionKey
} from '../security/keys';

export interface BeeKeyringOptions {
  /** Trust score published with this Bee's public identity. Default 1. */
  trustScore?: number;
  /** Load an existing Ed25519 signing key (base64 PKCS#8 DER) instead of generating one, e.g. from a secrets manager. */
  signingPrivateKey?: string;
  /** How long an encryption key stays current before a new one replaces it. Default 15 minutes. */
  encryptionKeyRotationMs?: number;
  /**
   * How long a replaced encryption key's private half is kept, so messages
   * already encrypted to it can still be decrypted. Default 5 minutes
   * (MessageSigner's default replay window). Deleted after that.
   */
  encryptionKeyRetentionMs?: number;
  /** Called with the new public identity whenever the encryption key rotates. */
  onRotate?: (identity: BeePublicIdentity) => void;
}

interface EncryptionKey {
  keyId: string;
  privateKey: KeyObject;
  publicKey: string;
  signature: string;
  createdAt: number;
  /** Set once the key has been replaced; the private key is deleted at this time. */
  deleteAt?: number;
}

export const DEFAULT_ENCRYPTION_KEY_ROTATION_MS = 15 * 60_000;
export const DEFAULT_ENCRYPTION_KEY_RETENTION_MS = 5 * 60_000;

/**
 * BeeKeyring - one Bee's private key material. Whoever holds the keyring
 * *is* that Bee, cryptographically; nothing else can get its private keys.
 *
 * - Signing: one long-lived Ed25519 keypair.
 * - Encryption: a rotating series of X25519 keypairs. Each is signed by
 *   the signing key (so senders can check a registry didn't substitute
 *   its own), stays current for `encryptionKeyRotationMs`, then is kept
 *   for `encryptionKeyRetentionMs` to decrypt in-flight messages, then
 *   deleted. Deleting old encryption private keys is what gives
 *   MessageEncryption forward secrecy: once a key is gone, nothing that
 *   was encrypted to it can be decrypted by anyone, including an attacker
 *   who later steals this keyring. Exposure from a compromise at time T
 *   is limited to traffic encrypted to keys still held at T - at most
 *   roughly `encryptionKeyRotationMs + encryptionKeyRetentionMs` of it.
 *
 * Rotation and deletion run on an unref'd timer (so an idle Bee still
 * sheds old keys without keeping the process alive), and are also
 * checked on every keyring access. JavaScript can't guarantee memory is
 * zeroized - deleted keys are dropped for garbage collection.
 *
 * Private keys live in ECMAScript private fields: they aren't enumerable,
 * serializable, or reachable through any accessor except the owner-only
 * methods below. Created via BeeIdentityManager.registerBeeIdentity(),
 * which returns the keyring to its owner exactly once.
 */
export class BeeKeyring {
  readonly beeName: string;
  readonly trustScore: number;
  readonly signingPublicKey: string;

  #signingPrivateKey: KeyObject;
  #encryptionKeys = new Map<string, EncryptionKey>();
  #currentKeyId!: string;
  #rotationMs: number;
  #retentionMs: number;
  #onRotate?: (identity: BeePublicIdentity) => void;
  #timer?: ReturnType<typeof setInterval>;

  constructor(beeName: string, options: BeeKeyringOptions = {}) {
    this.beeName = beeName;
    this.trustScore = options.trustScore ?? 1;
    this.#rotationMs = options.encryptionKeyRotationMs ?? DEFAULT_ENCRYPTION_KEY_ROTATION_MS;
    this.#retentionMs = options.encryptionKeyRetentionMs ?? DEFAULT_ENCRYPTION_KEY_RETENTION_MS;

    if (options.signingPrivateKey) {
      this.#signingPrivateKey = importPrivateKey(options.signingPrivateKey, 'ed25519');
    } else {
      this.#signingPrivateKey = generateKeyPairSync('ed25519').privateKey;
    }
    this.signingPublicKey = exportPublicKey(createPublicKey(this.#signingPrivateKey));

    this.#addEncryptionKey(Date.now());
    // Only notify rotations after construction; the registry reads the initial identity directly.
    this.#onRotate = options.onRotate;

    const tick = Math.max(1_000, Math.min(this.#rotationMs, this.#retentionMs));
    this.#timer = setInterval(() => this.maintain(), tick);
    this.#timer.unref?.();
  }

  /** The shareable half of this identity (current encryption key included). */
  getPublicIdentity(): BeePublicIdentity {
    this.maintain();
    const current = this.#encryptionKeys.get(this.#currentKeyId)!;
    return {
      beeName: this.beeName,
      signingPublicKey: this.signingPublicKey,
      encryptionPublicKey: current.publicKey,
      encryptionKeyId: current.keyId,
      encryptionKeySignature: current.signature,
      trustScore: this.trustScore
    };
  }

  /** Owner-only: the full identity, private keys included, for MessageSigner.sign(). */
  getIdentity(): BeeIdentity {
    const publicIdentity = this.getPublicIdentity();
    return {
      ...publicIdentity,
      signingPrivateKey: exportPrivateKey(this.#signingPrivateKey),
      encryptionPrivateKey: exportPrivateKey(this.#encryptionKeys.get(this.#currentKeyId)!.privateKey)
    };
  }

  /**
   * Owner-only: the encryption private key for `keyId`, if this keyring
   * still holds it. Undefined once the key has been deleted - by design,
   * messages encrypted to a deleted key can no longer be decrypted.
   */
  getEncryptionPrivateKey(keyId: string): string | undefined {
    this.maintain();
    const entry = this.#encryptionKeys.get(keyId);
    return entry ? exportPrivateKey(entry.privateKey) : undefined;
  }

  /** Ids of every encryption key this keyring still holds a private key for, oldest first. */
  getHeldEncryptionKeyIds(): string[] {
    this.maintain();
    return [...this.#encryptionKeys.keys()];
  }

  /** Replaces the current encryption key immediately (e.g. after a suspected compromise). */
  rotateEncryptionKey(): void {
    this.#rotate(Date.now());
  }

  #rotate(now: number): void {
    const previous = this.#encryptionKeys.get(this.#currentKeyId);
    if (previous) previous.deleteAt = now + this.#retentionMs;
    this.#addEncryptionKey(now);
    this.#onRotate?.(this.getPublicIdentity());
  }

  /** Rotates the current encryption key if it's due, and deletes replaced keys past their retention. */
  maintain(now = Date.now()): void {
    for (const [keyId, entry] of this.#encryptionKeys) {
      if (entry.deleteAt !== undefined && entry.deleteAt <= now) this.#encryptionKeys.delete(keyId);
    }

    const current = this.#encryptionKeys.get(this.#currentKeyId);
    if (current && now - current.createdAt >= this.#rotationMs) {
      this.#rotate(now);
    }
  }

  /** Stops the rotation timer and deletes every private key. The keyring is unusable afterwards. */
  destroy(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#encryptionKeys.clear();
  }

  #addEncryptionKey(now: number): void {
    const { privateKey, publicKey } = generateKeyPairSync('x25519');
    const keyId = randomBytes(8).toString('hex');
    const exportedPublicKey = exportPublicKey(publicKey);

    this.#encryptionKeys.set(keyId, {
      keyId,
      privateKey,
      publicKey: exportedPublicKey,
      signature: signEncryptionKey(this.#signingPrivateKey, this.beeName, keyId, exportedPublicKey),
      createdAt: now
    });
    this.#currentKeyId = keyId;
  }
}
