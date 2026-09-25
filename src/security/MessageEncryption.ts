import {
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes
} from 'crypto';
import { exportPublicKey, importPrivateKey, importPublicKey } from './keys';

export const ENCRYPTION_ALGORITHM = 'X25519-HKDF-SHA256-AES256GCM-v1';

export interface EncryptedEnvelope {
  alg: typeof ENCRYPTION_ALGORITHM;
  /** Base64 SPKI DER of the sender's one-time X25519 public key. Its private half was discarded inside encrypt(). */
  ephemeralPublicKey: string;
  /** Which of the recipient's encryption keys this was encrypted to (BeePublicIdentity.encryptionKeyId). */
  recipientKeyId: string;
  /** Base64 96-bit GCM nonce. */
  iv: string;
  /** Base64 GCM authentication tag. */
  authTag: string;
  /** Base64 AES-256-GCM ciphertext of the JSON-serialized payload. */
  ciphertext: string;
}

const AES_KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits, recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits, GCM's full tag
const HKDF_INFO_PREFIX = 'bhive/message-encryption/';

/**
 * MessageEncryption - hybrid encryption with an ephemeral X25519 key per
 * message, HKDF-SHA256 key derivation and AES-256-GCM.
 *
 * encrypt(): generates a fresh X25519 keypair for this message only,
 * computes ECDH(ephemeral private, recipient encryption public), derives
 * the AES key with HKDF (salt = both public keys, info = algorithm +
 * recipient key id), and encrypts with AES-256-GCM. The envelope header
 * (algorithm, both key identifiers) is bound in as GCM additional data,
 * so it can't be swapped without failing authentication. The ephemeral
 * private key and the AES key never leave the function.
 *
 * Forward secrecy - what it does and doesn't cover:
 * - Sender side: nothing long-lived on the sender can decrypt a message
 *   after it's sent, because the ephemeral private key is discarded.
 * - Recipient side: ECDH is symmetric, so the recipient's encryption
 *   private key plus the (public) ephemeral key in the envelope recovers
 *   the message key. Recording traffic and later stealing a recipient
 *   key therefore exposes every message encrypted to *that key*. Forward
 *   secrecy comes from the recipient's keys being short-lived: BeeKeyring
 *   rotates each Bee's encryption key and deletes old private keys after
 *   a retention window. Once deleted, messages encrypted to that key can
 *   never be decrypted - by the Bee or by anyone who compromises it later.
 *   Exposure from a compromise at time T is bounded to messages encrypted
 *   to keys still held at T.
 */
export class MessageEncryption {
  encrypt(payload: unknown, recipientEncryptionPublicKey: string, recipientKeyId: string): EncryptedEnvelope {
    const recipientPublicKey = importPublicKey(recipientEncryptionPublicKey, 'x25519');

    // Fresh per call - reusing an ephemeral key across messages would defeat its purpose.
    const ephemeral = generateKeyPairSync('x25519');
    const ephemeralPublicKey = exportPublicKey(ephemeral.publicKey);

    const sharedSecret = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipientPublicKey });
    const aesKey = this.deriveKey(sharedSecret, ephemeralPublicKey, exportPublicKey(recipientPublicKey), recipientKeyId);

    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', aesKey, iv, { authTagLength: AUTH_TAG_LENGTH });
    cipher.setAAD(this.additionalData(ephemeralPublicKey, recipientKeyId));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);

    return {
      alg: ENCRYPTION_ALGORITHM,
      ephemeralPublicKey,
      recipientKeyId,
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64')
    };
  }

  /**
   * Decrypts with the recipient's encryption private key for
   * `envelope.recipientKeyId`. Throws on a wrong key, tampered envelope,
   * or unknown algorithm.
   */
  decrypt(envelope: EncryptedEnvelope, recipientEncryptionPrivateKey: string): unknown {
    if (envelope.alg !== ENCRYPTION_ALGORITHM) {
      throw new Error(`Unsupported encryption algorithm "${envelope.alg}"`);
    }

    const privateKey = importPrivateKey(recipientEncryptionPrivateKey, 'x25519');
    const ephemeralPublicKey = importPublicKey(envelope.ephemeralPublicKey, 'x25519');
    const recipientPublicKey = exportPublicKey(createPublicKey(privateKey));

    const sharedSecret = diffieHellman({ privateKey, publicKey: ephemeralPublicKey });
    const aesKey = this.deriveKey(sharedSecret, envelope.ephemeralPublicKey, recipientPublicKey, envelope.recipientKeyId);

    // Pinning authTagLength makes Node reject truncated tags, which would otherwise weaken authentication.
    const decipher = createDecipheriv('aes-256-gcm', aesKey, Buffer.from(envelope.iv, 'base64'), {
      authTagLength: AUTH_TAG_LENGTH
    });
    decipher.setAAD(this.additionalData(envelope.ephemeralPublicKey, envelope.recipientKeyId));
    decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final()
    ]);

    return JSON.parse(plaintext.toString('utf8'));
  }

  private deriveKey(sharedSecret: Buffer, ephemeralPublicKey: string, recipientPublicKey: string, recipientKeyId: string): Buffer {
    if (sharedSecret.every(byte => byte === 0)) {
      // Only possible with a low-order (malicious) public key; refuse rather than derive a known key.
      throw new Error('Invalid X25519 public key: shared secret is all zeros');
    }

    // Salt binds the derived key to this exact pair of public keys; info binds it to the algorithm and key id.
    const salt = Buffer.concat([Buffer.from(ephemeralPublicKey, 'base64'), Buffer.from(recipientPublicKey, 'base64')]);
    const info = Buffer.from(`${HKDF_INFO_PREFIX}${ENCRYPTION_ALGORITHM}/${recipientKeyId}`);
    return Buffer.from(hkdfSync('sha256', sharedSecret, salt, info, AES_KEY_LENGTH));
  }

  private additionalData(ephemeralPublicKey: string, recipientKeyId: string): Buffer {
    return Buffer.from(JSON.stringify({ alg: ENCRYPTION_ALGORITHM, ephemeralPublicKey, recipientKeyId }));
  }
}
