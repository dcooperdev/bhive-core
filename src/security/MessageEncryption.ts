import {
  createCipheriv,
  createDecipheriv,
  constants,
  privateDecrypt,
  publicEncrypt,
  randomBytes
} from 'crypto';

export interface EncryptedPayload {
  /** Base64 AES-256-GCM ciphertext. */
  encrypted: string;
  /** Base64 96-bit initialization vector. */
  iv: string;
  /** Base64 GCM authentication tag. */
  authTag: string;
  /** Base64 RSA-OAEP-wrapped AES-256 key - only the holder of the matching RSA private key can unwrap it. */
  encryptedKey: string;
}

const AES_KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits, recommended for GCM

/**
 * MessageEncryption - end-to-end hybrid encryption.
 *
 * AES-256-GCM alone can't be "encrypted with a public key" (it's a
 * symmetric cipher). This implements standard envelope encryption: a
 * fresh random AES-256 key encrypts the message, and that AES key is
 * itself wrapped with the recipient's RSA-2048 public key (RSA-OAEP).
 * Only the holder of the matching RSA private key can unwrap the AES key
 * and therefore decrypt the message - true end-to-end encryption.
 */
export class MessageEncryption {
  encrypt(message: string, recipientPublicKey: string): EncryptedPayload {
    const aesKey = randomBytes(AES_KEY_LENGTH);
    const iv = randomBytes(IV_LENGTH);

    const cipher = createCipheriv('aes-256-gcm', aesKey, iv);
    const ciphertext = Buffer.concat([cipher.update(message, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const encryptedKey = publicEncrypt(
      { key: recipientPublicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      aesKey
    );

    return {
      encrypted: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      encryptedKey: encryptedKey.toString('base64')
    };
  }

  decrypt(payload: EncryptedPayload, recipientPrivateKey: string): string {
    const aesKey = privateDecrypt(
      { key: recipientPrivateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.from(payload.encryptedKey, 'base64')
    );

    const decipher = createDecipheriv('aes-256-gcm', aesKey, Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.encrypted, 'base64')),
      decipher.final()
    ]);

    return plaintext.toString('utf8');
  }
}
