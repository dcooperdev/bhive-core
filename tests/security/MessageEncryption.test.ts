import { MessageEncryption } from '../../src/security/MessageEncryption';
import { BeeIdentityManager } from '../../src/bee/BeeIdentityManager';
import { BeeIdentity } from '../../src/types';

describe('MessageEncryption', () => {
  let encryption: MessageEncryption;
  let alice: BeeIdentity;
  let bob: BeeIdentity;
  let eve: BeeIdentity;

  beforeAll(() => {
    // RSA-2048 generation is the slow part - share identities across tests in this file.
    const manager = new BeeIdentityManager();
    alice = manager.registerBeeIdentity('alice');
    bob = manager.registerBeeIdentity('bob');
    eve = manager.registerBeeIdentity('eve');
  });

  beforeEach(() => {
    encryption = new MessageEncryption();
  });

  it('should encrypt into a payload with encrypted/iv/authTag/encryptedKey fields', () => {
    const payload = encryption.encrypt('secret plan', bob.publicKey);

    expect(payload.encrypted).toEqual(expect.any(String));
    expect(payload.iv).toEqual(expect.any(String));
    expect(payload.authTag).toEqual(expect.any(String));
    expect(payload.encryptedKey).toEqual(expect.any(String));
  });

  it('should let the intended recipient decrypt back the original message', () => {
    const payload = encryption.encrypt('secret plan', bob.publicKey);
    expect(encryption.decrypt(payload, bob.privateKey)).toBe('secret plan');
  });

  it('should produce different ciphertext for the same message on repeated calls', () => {
    const first = encryption.encrypt('secret plan', bob.publicKey);
    const second = encryption.encrypt('secret plan', bob.publicKey);

    expect(first.encrypted).not.toBe(second.encrypted);
    expect(first.iv).not.toBe(second.iv);
  });

  it('should NOT let a third party decrypt with the wrong private key (end-to-end)', () => {
    const payload = encryption.encrypt('secret plan', bob.publicKey);
    expect(() => encryption.decrypt(payload, eve.privateKey)).toThrow();
  });

  it('should fail to decrypt if the ciphertext was tampered with', () => {
    const payload = encryption.encrypt('secret plan', bob.publicKey);
    const tampered = { ...payload, encrypted: Buffer.from('tampered-ciphertext').toString('base64') };

    expect(() => encryption.decrypt(tampered, bob.privateKey)).toThrow();
  });

  it('should fail to decrypt if the auth tag was tampered with', () => {
    const payload = encryption.encrypt('secret plan', bob.publicKey);
    const tampered = { ...payload, authTag: Buffer.alloc(16, 1).toString('base64') };

    expect(() => encryption.decrypt(tampered, bob.privateKey)).toThrow();
  });

  it('should fail to decrypt if the encrypted AES key was swapped for a different one', () => {
    const messageForBob = encryption.encrypt('secret plan', bob.publicKey);
    const messageForAlice = encryption.encrypt('other message', alice.publicKey);

    const mixed = { ...messageForBob, encryptedKey: messageForAlice.encryptedKey };

    expect(() => encryption.decrypt(mixed, bob.privateKey)).toThrow();
  });

  it('should round-trip a longer message correctly', () => {
    const longMessage = 'A'.repeat(10_000) + ' - end of message';
    const payload = encryption.encrypt(longMessage, alice.publicKey);
    expect(encryption.decrypt(payload, alice.privateKey)).toBe(longMessage);
  });

  it('should round-trip an empty string', () => {
    const payload = encryption.encrypt('', alice.publicKey);
    expect(encryption.decrypt(payload, alice.privateKey)).toBe('');
  });
});
