import { createHash, randomUUID } from 'crypto';
import { BeePublicIdentity, SecureAgentMessage } from '../types';
import type { BeeKeyring } from '../bee/BeeKeyring';
import { MessageSigner } from './MessageSigner';
import { ENCRYPTION_ALGORITHM, MessageEncryption } from './MessageEncryption';
import { verifyEncryptionKeySignature } from './keys';

export { SecureAgentMessage, SecurityConfig } from '../types';

/** Thrown for any failure in the decrypt/verify pipeline (as opposed to an ordinary delegation failure). */
export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityError';
  }
}

/** Builds a fresh, unsigned, unencrypted envelope. Seal it via Bee.sealMessage()/sealSecureMessage() before sending. */
export function createSecureMessage(from: string, to: string, data: unknown): SecureAgentMessage {
  return { id: randomUUID(), from, to, timestamp: Date.now(), data };
}

export function isSecureMessage(value: unknown): value is SecureAgentMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SecureAgentMessage>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.from === 'string' &&
    typeof candidate.to === 'string' &&
    typeof candidate.timestamp === 'number'
  );
}

/**
 * What a SecureAgentMessage's signature covers: the plaintext plus the
 * message id and sender/recipient names, so a signed message can't be
 * replayed to a different recipient, re-attributed to a different sender,
 * or have its id swapped. (Nonce and timestamp are added by MessageSigner.)
 */
export function signedContent(id: string, from: string, to: string, data: unknown): unknown {
  return { id, from, to, data };
}

/**
 * The plaintext inside an encrypted SecureAgentMessage. The signature
 * travels *inside* the ciphertext, never in the clear: a visible signature
 * over the plaintext would let anyone with the sender's public key confirm
 * guesses of a low-entropy payload offline, without breaking encryption.
 */
interface SealedPayload {
  data: unknown;
  signature?: string;
}

/** What openSecureMessage() recovers: the plaintext and, if the message was signed, its signature. */
export interface OpenedMessage {
  data: unknown;
  signature?: string;
}

const signer = new MessageSigner();
const encryption = new MessageEncryption();

/**
 * Builds a SecureAgentMessage from `sender` to `recipient`.
 *
 * - Sign: Ed25519 over signedContent(id, from, to, data) + nonce + timestamp,
 *   with the sender's own key.
 * - Encrypt: encrypts `{ data, signature }` together to the recipient's
 *   current X25519 key (after checking that key is signed by the
 *   recipient's signing key). When encrypted, the signature exists only
 *   inside the ciphertext; `message.signature` stays unset. Nonce and
 *   timestamp stay outside (they reveal nothing on their own and are
 *   covered by the signature).
 *
 * Signed-only messages carry `message.signature` in the clear, as before.
 */
export function sealSecureMessage(
  sender: BeeKeyring,
  recipient: BeePublicIdentity,
  data: unknown,
  options: { sign?: boolean; encrypt?: boolean }
): SecureAgentMessage {
  const message = createSecureMessage(sender.beeName, recipient.beeName, data);
  let signature: string | undefined;

  if (options.sign) {
    const signed = signer.sign(signedContent(message.id, message.from, message.to, data), sender.getIdentity());
    signature = signed.signature;
    message.nonce = signed.nonce;
    message.timestamp = signed.timestamp;
  }

  if (options.encrypt) {
    if (!verifyEncryptionKeySignature(recipient)) {
      throw new SecurityError(`Encryption key for "${recipient.beeName}" is not signed by its signing key`);
    }
    const sealed: SealedPayload = signature ? { data, signature } : { data };
    const envelope = encryption.encrypt(sealed, recipient.encryptionPublicKey, recipient.encryptionKeyId);
    message.data = envelope.ciphertext;
    message.iv = envelope.iv;
    message.authTag = envelope.authTag;
    message.ephemeralPublicKey = envelope.ephemeralPublicKey;
    message.encryptionKeyId = envelope.recipientKeyId;
    message.encrypted = true;
  } else if (signature) {
    message.signature = signature;
  }

  return message;
}

/**
 * Recovers the plaintext and signature of a SecureAgentMessage addressed
 * to `recipient`. For an encrypted message this decrypts with the
 * recipient's own key for `message.encryptionKeyId` (throwing if that key
 * was rotated out and deleted - by design, see BeeKeyring - or if GCM
 * authentication fails) and takes the signature from inside the
 * ciphertext. For a plaintext message it returns `message.data` and
 * `message.signature` as-is.
 *
 * Does NOT verify the signature: verify the result afterwards with
 * MessageSigner.verify(signedContent(id, from, to, data), ...).
 */
export function openSecureMessage(recipient: BeeKeyring, message: SecureAgentMessage): OpenedMessage {
  if (!message.encrypted) {
    return { data: message.data, signature: message.signature };
  }

  if (message.signature !== undefined) {
    // A legitimate encrypted message never carries an outer signature.
    throw new SecurityError('Encrypted message must not carry a signature outside the ciphertext');
  }

  const privateKey = recipient.getEncryptionPrivateKey(message.encryptionKeyId ?? '');
  if (!privateKey) {
    throw new SecurityError(`Encryption key "${message.encryptionKeyId}" is unknown or has been deleted`);
  }

  const sealed = encryption.decrypt(
    {
      alg: ENCRYPTION_ALGORITHM,
      ephemeralPublicKey: message.ephemeralPublicKey ?? '',
      recipientKeyId: message.encryptionKeyId ?? '',
      iv: message.iv ?? '',
      authTag: message.authTag ?? '',
      ciphertext: message.data as string
    },
    privateKey
  );

  if (!isSealedPayload(sealed)) {
    throw new SecurityError('Decrypted payload is malformed');
  }
  return { data: sealed.data, signature: sealed.signature };
}

function isSealedPayload(value: unknown): value is SealedPayload {
  if (!value || typeof value !== 'object' || !('data' in value)) return false;
  const signature = (value as SealedPayload).signature;
  return signature === undefined || typeof signature === 'string';
}

/**
 * What an AttestationChain records for a message. Signed-only messages
 * record their (already public) signature. Encrypted messages record a
 * SHA-256 digest of the sealed envelope instead: it binds the chain to the
 * exact message without re-exposing the signature hidden in the ciphertext.
 */
export function attestationFingerprint(message: SecureAgentMessage): string {
  if (!message.encrypted) return message.signature ?? '';

  const envelope = JSON.stringify([
    message.id,
    message.ephemeralPublicKey,
    message.encryptionKeyId,
    message.iv,
    message.authTag,
    message.data
  ]);
  return `sha256:${createHash('sha256').update(envelope).digest('hex')}`;
}
