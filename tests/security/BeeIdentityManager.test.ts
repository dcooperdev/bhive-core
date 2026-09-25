import { createPublicKey } from 'crypto';
import { BeeIdentityManager, getDefaultBeeIdentityManager } from '../../src/bee/BeeIdentityManager';
import { BeeKeyring } from '../../src/bee/BeeKeyring';
import { verifyEncryptionKeySignature } from '../../src/security/keys';

const keyType = (base64Der: string) =>
  createPublicKey({ key: Buffer.from(base64Der, 'base64'), format: 'der', type: 'spki' }).asymmetricKeyType;

describe('BeeIdentityManager', () => {
  let manager: BeeIdentityManager;
  const keyrings: BeeKeyring[] = [];
  const register = (...args: Parameters<BeeIdentityManager['registerBeeIdentity']>) => {
    const keyring = manager.registerBeeIdentity(...args);
    keyrings.push(keyring);
    return keyring;
  };

  beforeEach(() => {
    manager = new BeeIdentityManager();
  });

  afterEach(() => {
    keyrings.splice(0).forEach(keyring => keyring.destroy());
  });

  describe('registerBeeIdentity', () => {
    it('should generate separate Ed25519 signing and X25519 encryption keypairs', () => {
      const keyring = register('classifier');
      const identity = keyring.getIdentity();

      expect(identity.beeName).toBe('classifier');
      expect(keyType(identity.signingPublicKey)).toBe('ed25519');
      expect(keyType(identity.encryptionPublicKey)).toBe('x25519');
      expect(identity.signingPrivateKey).not.toBe(identity.encryptionPrivateKey);
      expect(identity.trustScore).toBe(1);
    });

    it('should accept a Bee-like object and use its getName()', () => {
      const fakeBee = { getName: () => 'responder' } as any;
      expect(register(fakeBee).beeName).toBe('responder');
    });

    it('should refuse to register the same name twice (no second keyring for an existing Bee)', () => {
      register('classifier');
      expect(() => manager.registerBeeIdentity('classifier')).toThrow(/already registered/);
    });

    it('should generate distinct keypairs for different names', () => {
      const a = register('a').getIdentity();
      const b = register('b').getIdentity();

      expect(a.signingPublicKey).not.toBe(b.signingPublicKey);
      expect(a.encryptionPublicKey).not.toBe(b.encryptionPublicKey);
    });

    it('should accept a custom trustScore', () => {
      expect(register('auditor', { trustScore: 0.5 }).getPublicIdentity().trustScore).toBe(0.5);
    });

    it('should load an existing signing key instead of generating one', () => {
      const original = register('template');
      const signingPrivateKey = original.getIdentity().signingPrivateKey;

      const other = new BeeIdentityManager();
      const reloaded = other.registerBeeIdentity('template', { signingPrivateKey });
      keyrings.push(reloaded);

      expect(reloaded.signingPublicKey).toBe(original.signingPublicKey);
      // Encryption keys are always fresh.
      expect(reloaded.getPublicIdentity().encryptionPublicKey).not.toBe(original.getPublicIdentity().encryptionPublicKey);
    });

    it('should sign each encryption key with the signing key', () => {
      register('classifier');
      expect(verifyEncryptionKeySignature(manager.getBeeIdentity('classifier')!)).toBe(true);
    });
  });

  describe('getBeeIdentity', () => {
    it('should return undefined for an unregistered name', () => {
      expect(manager.getBeeIdentity('nobody')).toBeUndefined();
    });

    it('should return the public identity only - never private keys', () => {
      const keyring = register('classifier');
      const lookedUp = manager.getBeeIdentity('classifier')!;

      expect(lookedUp).toEqual(keyring.getPublicIdentity());
      expect(lookedUp).not.toHaveProperty('signingPrivateKey');
      expect(lookedUp).not.toHaveProperty('encryptionPrivateKey');
    });

    it('should return a copy that callers cannot use to alter the registry', () => {
      register('classifier');
      const lookedUp = manager.getBeeIdentity('classifier')!;
      lookedUp.encryptionPublicKey = 'attacker-key';

      expect(manager.getBeeIdentity('classifier')!.encryptionPublicKey).not.toBe('attacker-key');
    });

    it('should follow encryption key rotation', () => {
      const keyring = register('classifier');
      const before = manager.getBeeIdentity('classifier')!;

      keyring.rotateEncryptionKey();
      const after = manager.getBeeIdentity('classifier')!;

      expect(after.encryptionKeyId).not.toBe(before.encryptionKeyId);
      expect(after.signingPublicKey).toBe(before.signingPublicKey);
      expect(verifyEncryptionKeySignature(after)).toBe(true);
    });
  });

  describe('hasIdentity / removeIdentity / listIdentities', () => {
    it('should track registered identities', () => {
      expect(manager.hasIdentity('classifier')).toBe(false);
      register('classifier');
      expect(manager.hasIdentity('classifier')).toBe(true);
      expect(manager.listIdentities()).toEqual(['classifier']);
    });

    it('should remove an identity, and ignore later rotations from its old keyring', () => {
      const keyring = register('classifier');
      manager.removeIdentity('classifier');

      expect(manager.hasIdentity('classifier')).toBe(false);
      keyring.rotateEncryptionKey();
      expect(manager.getBeeIdentity('classifier')).toBeUndefined();
    });
  });

  describe('loadIdentity', () => {
    it("should register another process's public identity", () => {
      const remote = register('remote-bee').getPublicIdentity();
      const local = new BeeIdentityManager();

      local.loadIdentity(remote);

      expect(local.getBeeIdentity('remote-bee')).toEqual(remote);
    });

    it('should reject a private identity passed in, storing only public fields', () => {
      const full = register('remote-bee').getIdentity();
      const local = new BeeIdentityManager();

      local.loadIdentity(full);

      expect(local.getBeeIdentity('remote-bee')).not.toHaveProperty('signingPrivateKey');
      expect(local.getBeeIdentity('remote-bee')).not.toHaveProperty('encryptionPrivateKey');
    });

    it('should reject an encryption key not signed by the identity\'s own signing key', () => {
      const victim = register('victim').getPublicIdentity();
      const attacker = register('attacker').getPublicIdentity();
      const local = new BeeIdentityManager();

      expect(() =>
        local.loadIdentity({
          ...victim,
          encryptionPublicKey: attacker.encryptionPublicKey,
          encryptionKeyId: attacker.encryptionKeyId
        })
      ).toThrow(/not signed/);
    });

    it('should reject a signing-key change for a known Bee', () => {
      const real = register('bee').getPublicIdentity();
      const other = new BeeIdentityManager();
      const impostor = other.registerBeeIdentity('bee');
      keyrings.push(impostor);

      const local = new BeeIdentityManager();
      local.loadIdentity(real);

      expect(() => local.loadIdentity(impostor.getPublicIdentity())).toThrow(/different signing key/);
    });
  });

  describe('getDefaultBeeIdentityManager', () => {
    it('should return the same shared instance across calls', () => {
      expect(getDefaultBeeIdentityManager()).toBe(getDefaultBeeIdentityManager());
    });
  });
});
