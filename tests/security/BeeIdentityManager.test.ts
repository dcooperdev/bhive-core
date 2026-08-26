import { BeeIdentityManager, getDefaultBeeIdentityManager } from '../../src/bee/BeeIdentityManager';

describe('BeeIdentityManager', () => {
  let manager: BeeIdentityManager;

  beforeEach(() => {
    manager = new BeeIdentityManager();
  });

  describe('registerBeeIdentity', () => {
    it('should generate an RSA-2048 keypair for a new name', () => {
      const identity = manager.registerBeeIdentity('classifier');

      expect(identity.beeName).toBe('classifier');
      expect(identity.publicKey).toMatch(/-----BEGIN PUBLIC KEY-----/);
      expect(identity.privateKey).toMatch(/-----BEGIN PRIVATE KEY-----/);
      expect(identity.trustScore).toBe(1);
    });

    it('should accept a Bee-like object and use its getName()', () => {
      const fakeBee = { getName: () => 'responder' } as any;
      const identity = manager.registerBeeIdentity(fakeBee);

      expect(identity.beeName).toBe('responder');
    });

    it('should return the same identity on repeated registration of the same name', () => {
      const first = manager.registerBeeIdentity('classifier');
      const second = manager.registerBeeIdentity('classifier');

      expect(second).toBe(first);
    });

    it('should generate distinct keypairs for different names', () => {
      const a = manager.registerBeeIdentity('a');
      const b = manager.registerBeeIdentity('b');

      expect(a.publicKey).not.toBe(b.publicKey);
      expect(a.privateKey).not.toBe(b.privateKey);
    });

    it('should accept a custom trustScore', () => {
      const identity = manager.registerBeeIdentity('auditor', 0.5);
      expect(identity.trustScore).toBe(0.5);
    });
  });

  describe('getBeeIdentity', () => {
    it('should return undefined for an unregistered name', () => {
      expect(manager.getBeeIdentity('nobody')).toBeUndefined();
    });

    it('should return the registered identity', () => {
      const registered = manager.registerBeeIdentity('classifier');
      expect(manager.getBeeIdentity('classifier')).toBe(registered);
    });
  });

  describe('hasIdentity / removeIdentity / listIdentities', () => {
    it('should track registered identities', () => {
      expect(manager.hasIdentity('classifier')).toBe(false);
      manager.registerBeeIdentity('classifier');
      expect(manager.hasIdentity('classifier')).toBe(true);
      expect(manager.listIdentities()).toEqual(['classifier']);
    });

    it('should remove an identity', () => {
      manager.registerBeeIdentity('classifier');
      manager.removeIdentity('classifier');

      expect(manager.hasIdentity('classifier')).toBe(false);
      expect(manager.getBeeIdentity('classifier')).toBeUndefined();
    });
  });

  describe('loadIdentity', () => {
    it('should load a pre-existing identity instead of generating a new keypair', () => {
      const preExisting = manager.registerBeeIdentity('template');
      const fresh = new BeeIdentityManager();

      fresh.loadIdentity(preExisting);

      expect(fresh.getBeeIdentity('template')).toEqual(preExisting);
    });
  });

  describe('getDefaultBeeIdentityManager', () => {
    it('should return the same shared instance across calls', () => {
      const first = getDefaultBeeIdentityManager();
      const second = getDefaultBeeIdentityManager();

      expect(first).toBe(second);
    });
  });
});
