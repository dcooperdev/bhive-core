import * as crypto from 'crypto';
import { MessageEncryption, EncryptedEnvelope, ENCRYPTION_ALGORITHM } from '../../src/security/MessageEncryption';
import { BeeIdentityManager } from '../../src/bee/BeeIdentityManager';
import { BeeKeyring } from '../../src/bee/BeeKeyring';
import { BeeIdentity } from '../../src/types';

describe('MessageEncryption', () => {
  let encryption: MessageEncryption;
  let keyrings: BeeKeyring[];
  let alice: BeeIdentity;
  let bob: BeeIdentity;
  let eve: BeeIdentity;

  const encryptToBob = (payload: unknown): EncryptedEnvelope =>
    encryption.encrypt(payload, bob.encryptionPublicKey, bob.encryptionKeyId);

  beforeAll(() => {
    const manager = new BeeIdentityManager();
    keyrings = ['alice', 'bob', 'eve'].map(name => manager.registerBeeIdentity(name));
    [alice, bob, eve] = keyrings.map(keyring => keyring.getIdentity());
  });

  afterAll(() => keyrings.forEach(keyring => keyring.destroy()));

  beforeEach(() => {
    encryption = new MessageEncryption();
  });

  afterEach(() => jest.restoreAllMocks());

  describe('round trip', () => {
    it("encrypts to A's public key and decrypts with A's private key", () => {
      const envelope = encryptToBob('secret plan');
      expect(encryption.decrypt(envelope, bob.encryptionPrivateKey)).toBe('secret plan');
    });

    it('round-trips structured payloads, long payloads and empty strings', () => {
      const structured = { task: 'label', ids: [1, 2, 3], nested: { ok: true } };
      expect(encryption.decrypt(encryptToBob(structured), bob.encryptionPrivateKey)).toEqual(structured);

      const long = 'A'.repeat(10_000) + ' - end of message';
      expect(encryption.decrypt(encryptToBob(long), bob.encryptionPrivateKey)).toBe(long);

      expect(encryption.decrypt(encryptToBob(''), bob.encryptionPrivateKey)).toBe('');
    });
  });

  describe('confidentiality', () => {
    it("encrypts to A and fails to decrypt with B's private key", () => {
      const envelope = encryptToBob('secret plan');
      expect(() => encryption.decrypt(envelope, eve.encryptionPrivateKey)).toThrow();
      expect(() => encryption.decrypt(envelope, alice.encryptionPrivateKey)).toThrow();
    });

    it('refuses an Ed25519 signing key used as an encryption key, in either direction', () => {
      expect(() => encryption.encrypt('x', bob.signingPublicKey, bob.encryptionKeyId)).toThrow(/x25519/);
      expect(() => encryption.decrypt(encryptToBob('x'), bob.signingPrivateKey)).toThrow(/x25519/);
    });

    it('refuses a low-order recipient public key instead of deriving a predictable key', () => {
      // SPKI header for X25519 followed by the all-zero u-coordinate (a low-order point).
      const lowOrderKey = Buffer.concat([
        Buffer.from('302a300506032b656e032100', 'hex'),
        Buffer.alloc(32)
      ]).toString('base64');

      expect(() => encryption.encrypt('x', lowOrderKey, 'k')).toThrow();
    });
  });

  describe('integrity', () => {
    it('fails if the ciphertext was tampered with', () => {
      const envelope = encryptToBob('secret plan');
      const bytes = Buffer.from(envelope.ciphertext, 'base64');
      bytes[0] ^= 1;
      expect(() => encryption.decrypt({ ...envelope, ciphertext: bytes.toString('base64') }, bob.encryptionPrivateKey)).toThrow();
    });

    it('fails if the auth tag was tampered with or truncated', () => {
      const envelope = encryptToBob('secret plan');
      const tag = Buffer.from(envelope.authTag, 'base64');

      expect(() =>
        encryption.decrypt({ ...envelope, authTag: Buffer.alloc(16, 1).toString('base64') }, bob.encryptionPrivateKey)
      ).toThrow();
      expect(() =>
        encryption.decrypt({ ...envelope, authTag: tag.subarray(0, 4).toString('base64') }, bob.encryptionPrivateKey)
      ).toThrow();
    });

    it('fails if the header (ephemeral key or key id) was swapped', () => {
      const first = encryptToBob('secret plan');
      const second = encryptToBob('other message');

      expect(() =>
        encryption.decrypt({ ...first, ephemeralPublicKey: second.ephemeralPublicKey }, bob.encryptionPrivateKey)
      ).toThrow();
      expect(() => encryption.decrypt({ ...first, recipientKeyId: 'another-key' }, bob.encryptionPrivateKey)).toThrow();
    });

    it('rejects an unknown algorithm identifier', () => {
      const envelope = encryptToBob('secret plan');
      expect(() =>
        encryption.decrypt({ ...envelope, alg: 'RSA-OAEP' as typeof ENCRYPTION_ALGORITHM }, bob.encryptionPrivateKey)
      ).toThrow(/Unsupported encryption algorithm/);
    });
  });

  describe('ephemeral keys', () => {
    it('uses a fresh ephemeral keypair on every encrypt() call, even for identical input', () => {
      const envelopes = Array.from({ length: 50 }, () => encryptToBob('same message'));

      expect(new Set(envelopes.map(e => e.ephemeralPublicKey)).size).toBe(50);
      expect(new Set(envelopes.map(e => e.ciphertext)).size).toBe(50);
      expect(new Set(envelopes.map(e => e.iv)).size).toBe(50);
    });

    it('generates exactly one new X25519 keypair per encrypt() call', async () => {
      const generated: string[] = [];

      await jest.isolateModulesAsync(async () => {
        jest.doMock('crypto', () => {
          const actual = jest.requireActual<typeof crypto>('crypto');
          return {
            ...actual,
            generateKeyPairSync: (type: string, ...rest: unknown[]) => {
              generated.push(type);
              return (actual.generateKeyPairSync as (...args: unknown[]) => unknown)(type, ...rest);
            }
          };
        });
        const { MessageEncryption: Isolated } = await import('../../src/security/MessageEncryption');
        const isolated = new Isolated();

        isolated.encrypt('one', bob.encryptionPublicKey, bob.encryptionKeyId);
        isolated.encrypt('two', bob.encryptionPublicKey, bob.encryptionKeyId);
        isolated.encrypt('three', bob.encryptionPublicKey, bob.encryptionKeyId);
      });

      expect(generated).toEqual(['x25519', 'x25519', 'x25519']);
    });

    it('returns only public values: no ephemeral private key or derived AES key is retrievable from the envelope', () => {
      const envelope = encryptToBob('secret plan');

      expect(Object.keys(envelope).sort()).toEqual(
        ['alg', 'authTag', 'ciphertext', 'ephemeralPublicKey', 'iv', 'recipientKeyId'].sort()
      );

      // The ephemeral key is a *public* X25519 key...
      const ephemeral = crypto.createPublicKey({
        key: Buffer.from(envelope.ephemeralPublicKey, 'base64'),
        format: 'der',
        type: 'spki'
      });
      expect(ephemeral.type).toBe('public');
      expect(ephemeral.asymmetricKeyType).toBe('x25519');

      // ...and no field is a private key or a 32-byte AES key.
      for (const value of Object.values(envelope)) {
        expect(() =>
          crypto.createPrivateKey({ key: Buffer.from(value, 'base64'), format: 'der', type: 'pkcs8' })
        ).toThrow();
      }
      expect(Buffer.from(envelope.iv, 'base64')).toHaveLength(12);
      expect(Buffer.from(envelope.authTag, 'base64')).toHaveLength(16);
      expect(JSON.stringify(envelope)).not.toMatch(/PRIVATE/);
    });
  });

  describe('forward secrecy (via BeeKeyring rotation)', () => {
    it('makes captured ciphertext undecryptable once the recipient key it was encrypted to is deleted - even with the whole keyring stolen', () => {
      const manager = new BeeIdentityManager();
      let now = Date.now();
      jest.spyOn(Date, 'now').mockImplementation(() => now);
      const carol = manager.registerBeeIdentity('carol', {
        encryptionKeyRotationMs: 60_000,
        encryptionKeyRetentionMs: 10_000
      });

      // Sender encrypts to carol's current public key; an attacker records the ciphertext.
      const carolPublic = manager.getBeeIdentity('carol')!;
      const captured = encryption.encrypt('past secret', carolPublic.encryptionPublicKey, carolPublic.encryptionKeyId);

      // Still decryptable while the key is current.
      expect(encryption.decrypt(captured, carol.getEncryptionPrivateKey(captured.recipientKeyId)!)).toBe('past secret');

      // Rotation, then the retention window passes: the old private key is deleted.
      now += 60_000;
      carol.maintain();
      expect(carol.getEncryptionPrivateKey(captured.recipientKeyId)).toBeDefined(); // retained for in-flight messages
      now += 10_000;
      carol.maintain();
      expect(carol.getEncryptionPrivateKey(captured.recipientKeyId)).toBeUndefined();

      // Attacker compromises carol *now*: every private key she holds.
      const stolen = carol.getHeldEncryptionKeyIds().map(id => carol.getEncryptionPrivateKey(id)!);
      stolen.push(carol.getIdentity().encryptionPrivateKey);
      expect(stolen.length).toBeGreaterThan(0);

      for (const key of stolen) {
        expect(() => encryption.decrypt(captured, key)).toThrow();
      }

      // The registry now advertises the new key; new messages still work.
      const rotated = manager.getBeeIdentity('carol')!;
      expect(rotated.encryptionKeyId).not.toBe(captured.recipientKeyId);
      const fresh = encryption.encrypt('new secret', rotated.encryptionPublicKey, rotated.encryptionKeyId);
      expect(encryption.decrypt(fresh, carol.getEncryptionPrivateKey(rotated.encryptionKeyId)!)).toBe('new secret');

      carol.destroy();
    });
  });
});
