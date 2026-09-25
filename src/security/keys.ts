import { createPrivateKey, createPublicKey, KeyObject, sign, verify } from 'crypto';
import { BeePublicIdentity } from '../types';

export type BeeKeyType = 'ed25519' | 'x25519';

/**
 * Key encoding helpers shared by BeeKeyring, MessageSigner and
 * MessageEncryption. Every key crosses API boundaries as base64 DER
 * (SPKI for public keys, PKCS#8 for private keys), and every import
 * checks the key's algorithm so an X25519 key can never be used where an
 * Ed25519 key is expected, or vice versa.
 */
export function exportPublicKey(key: KeyObject): string {
  return key.export({ type: 'spki', format: 'der' }).toString('base64');
}

export function exportPrivateKey(key: KeyObject): string {
  return key.export({ type: 'pkcs8', format: 'der' }).toString('base64');
}

export function importPublicKey(base64Der: string, expectedType: BeeKeyType): KeyObject {
  const key = createPublicKey({ key: Buffer.from(base64Der, 'base64'), format: 'der', type: 'spki' });
  assertKeyType(key, expectedType);
  return key;
}

export function importPrivateKey(base64Der: string, expectedType: BeeKeyType): KeyObject {
  const key = createPrivateKey({ key: Buffer.from(base64Der, 'base64'), format: 'der', type: 'pkcs8' });
  assertKeyType(key, expectedType);
  return key;
}

function assertKeyType(key: KeyObject, expectedType: BeeKeyType): void {
  if (key.asymmetricKeyType !== expectedType) {
    throw new Error(`Expected an ${expectedType} key, got ${key.asymmetricKeyType ?? 'unknown'}`);
  }
}

/** The exact bytes a Bee's signing key signs to vouch for one of its encryption keys. */
function encryptionKeyStatement(beeName: string, keyId: string, encryptionPublicKey: string): Buffer {
  return Buffer.from(JSON.stringify({ purpose: 'bhive-encryption-key-v1', beeName, keyId, encryptionPublicKey }));
}

export function signEncryptionKey(
  signingPrivateKey: KeyObject,
  beeName: string,
  keyId: string,
  encryptionPublicKey: string
): string {
  return sign(null, encryptionKeyStatement(beeName, keyId, encryptionPublicKey), signingPrivateKey).toString('base64');
}

/**
 * True if `identity.encryptionPublicKey` is vouched for by
 * `identity.signingPublicKey`. Senders should check this before
 * encrypting, so whoever serves the identity (a registry, a network hop)
 * can't swap in an encryption key it controls.
 */
export function verifyEncryptionKeySignature(identity: BeePublicIdentity): boolean {
  try {
    return verify(
      null,
      encryptionKeyStatement(identity.beeName, identity.encryptionKeyId, identity.encryptionPublicKey),
      importPublicKey(identity.signingPublicKey, 'ed25519'),
      Buffer.from(identity.encryptionKeySignature, 'base64')
    );
  } catch {
    return false;
  }
}
