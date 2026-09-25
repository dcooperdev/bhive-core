import { MessageSigner } from '../../src/security/MessageSigner';
import { BeeIdentityManager } from '../../src/bee/BeeIdentityManager';
import { BeeKeyring } from '../../src/bee/BeeKeyring';
import { InMemoryStorage } from '../../src/storage/InMemoryStorage';
import { BeeIdentity } from '../../src/types';

describe('MessageSigner', () => {
  let signer: MessageSigner;
  let registry: BeeIdentityManager;
  let aliceKeyring: BeeKeyring;
  let bobKeyring: BeeKeyring;
  let alice: BeeIdentity;
  let alicePublicKey: string;
  let bobPublicKey: string;

  beforeEach(() => {
    signer = new MessageSigner();
    registry = new BeeIdentityManager();
    aliceKeyring = registry.registerBeeIdentity('alice');
    bobKeyring = registry.registerBeeIdentity('bob');
    alice = aliceKeyring.getIdentity();
    alicePublicKey = registry.getBeeIdentity('alice')!.signingPublicKey;
    bobPublicKey = registry.getBeeIdentity('bob')!.signingPublicKey;
  });

  afterEach(() => {
    aliceKeyring.destroy();
    bobKeyring.destroy();
    jest.restoreAllMocks();
  });

  describe('sign', () => {
    it('should produce a 64-byte Ed25519 signature, nonce, and timestamp', () => {
      const envelope = signer.sign('hello', alice);

      expect(Buffer.from(envelope.signature, 'base64')).toHaveLength(64);
      expect(envelope.nonce).toMatch(/^[0-9a-f]{32}$/);
      expect(envelope.timestamp).toBeLessThanOrEqual(Date.now());
    });

    it('should produce a different nonce on every call', () => {
      const first = signer.sign('hello', alice);
      const second = signer.sign('hello', alice);

      expect(first.nonce).not.toBe(second.nonce);
      expect(first.signature).not.toBe(second.signature);
    });

    it('should refuse an X25519 key passed as a signing key', () => {
      expect(() => signer.sign('hello', { signingPrivateKey: alice.encryptionPrivateKey })).toThrow(/ed25519/);
    });
  });

  describe('verify', () => {
    it("should accept a message signed with A's private key when verified with A's public key", async () => {
      const envelope = signer.sign('hello', alice);
      await expect(signer.verify('hello', envelope, alicePublicKey)).resolves.toEqual({ valid: true });
    });

    it("should reject a message signed by A when verified with B's public key", async () => {
      const envelope = signer.sign('hello', alice);
      const result = await signer.verify('hello', envelope, bobPublicKey);

      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/Invalid signature/);
    });

    it('should reject when the data has been tampered with', async () => {
      const envelope = signer.sign('hello', alice);
      const result = await signer.verify('goodbye', envelope, alicePublicKey);

      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/Invalid signature/);
    });

    it('should reject when the nonce or timestamp has been tampered with', async () => {
      const envelope = signer.sign('hello', alice);

      expect((await signer.verify('hello', { ...envelope, nonce: 'f'.repeat(32) }, alicePublicKey)).valid).toBe(false);
      expect((await signer.verify('hello', { ...envelope, timestamp: envelope.timestamp + 1 }, alicePublicKey)).valid).toBe(false);
    });

    it('should reject a malformed signature or public key without throwing', async () => {
      const envelope = signer.sign('hello', alice);

      expect((await signer.verify('hello', { ...envelope, signature: 'ab' }, alicePublicKey)).reason).toMatch(/Invalid signature/);
      expect((await signer.verify('hello', envelope, 'not-a-key')).reason).toMatch(/Invalid signature/);
      // An X25519 public key must never be accepted as a verification key.
      const encryptionKey = registry.getBeeIdentity('alice')!.encryptionPublicKey;
      expect((await signer.verify('hello', envelope, encryptionKey)).reason).toMatch(/Invalid signature/);
    });

    it('should reject the same nonce on a second verification (replay attack)', async () => {
      const envelope = signer.sign('hello', alice);

      expect((await signer.verify('hello', envelope, alicePublicKey)).valid).toBe(true);

      const replay = await signer.verify('hello', envelope, alicePublicKey);
      expect(replay.valid).toBe(false);
      expect(replay.reason).toMatch(/Replay detected/);
    });

    it('should reject a message whose timestamp is outside the allowed window', async () => {
      // Sign "in the past" so the envelope is genuinely, validly old - the
      // signature covers the timestamp, so it can't be mutated afterwards.
      const tenMinutesAgo = Date.now() - 10 * 60_000;
      jest.spyOn(Date, 'now').mockReturnValueOnce(tenMinutesAgo);
      const envelope = signer.sign('hello', alice);

      const result = await signer.verify('hello', envelope, alicePublicKey, { maxAgeMs: 5 * 60_000 });

      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/timestamp/i);
    });

    it('should accept a custom maxAgeMs window', async () => {
      const envelope = signer.sign('hello', alice);
      expect((await signer.verify('hello', envelope, alicePublicKey, { maxAgeMs: 1_000 })).valid).toBe(true);
    });

    it('should forget nonces after resetNonceHistory()', async () => {
      const envelope = signer.sign('hello', alice);
      await signer.verify('hello', envelope, alicePublicKey);
      signer.resetNonceHistory();

      // Signature/timestamp are still valid, only nonce-replay state was cleared.
      expect((await signer.verify('hello', envelope, alicePublicKey)).valid).toBe(true);
    });
  });

  describe('non-repudiation', () => {
    it("gives other parties only A's public key - never a way to sign as A", () => {
      const aliceAsSeenByOthers = registry.getBeeIdentity('alice')!;

      expect(aliceAsSeenByOthers).not.toHaveProperty('signingPrivateKey');
      expect(aliceAsSeenByOthers).not.toHaveProperty('encryptionPrivateKey');
      // A second registration can't mint another keyring for an existing Bee.
      expect(() => registry.registerBeeIdentity('alice')).toThrow(/already registered/);
      // The keyring object itself exposes no private material through enumeration or serialization.
      expect(JSON.stringify(aliceKeyring)).not.toMatch(/PRIVATE|signingPrivateKey/);
      expect(Object.keys(aliceKeyring)).not.toEqual(expect.arrayContaining(['signingPrivateKey']));
    });

    it("rejects a forgery by B claiming to be A, since B only has its own private key", async () => {
      // B, holding only its own keyring plus A's public identity, builds the
      // best forgery it can: A's public identity with B's private key.
      const bobVerifier = new MessageSigner();
      const aliceAsSeenByBob = registry.getBeeIdentity('alice')!;
      const forged = bobVerifier.sign('pay bob', {
        signingPrivateKey: bobKeyring.getIdentity().signingPrivateKey
      });

      const result = await signer.verify('pay bob', forged, aliceAsSeenByBob.signingPublicKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/Invalid signature/);
    });
  });

  describe('nonce eviction (in-memory)', () => {
    const seenNonceCount = (s: MessageSigner): number =>
      (s as unknown as { seenNonces: Map<string, number> }).seenNonces.size;

    it('evicts expired nonces so history does not grow unbounded', async () => {
      const maxAgeMs = 60_000;
      let now = Date.now();
      jest.spyOn(Date, 'now').mockImplementation(() => now);

      for (let i = 0; i < 50; i++) {
        const envelope = signer.sign({ i }, alice);
        expect((await signer.verify({ i }, envelope, alicePublicKey, { maxAgeMs })).valid).toBe(true);
      }
      expect(seenNonceCount(signer)).toBe(50);

      now += maxAgeMs + 1;

      for (let i = 0; i < 5; i++) {
        const envelope = signer.sign({ fresh: i }, alice);
        expect((await signer.verify({ fresh: i }, envelope, alicePublicKey, { maxAgeMs })).valid).toBe(true);
      }
      // The 50 expired nonces were evicted; only the 5 fresh ones remain.
      expect(seenNonceCount(signer)).toBe(5);
    });

    it('does not claim a nonce for an envelope rejected on timestamp', async () => {
      jest.spyOn(Date, 'now').mockReturnValueOnce(Date.now() - 10 * 60_000);
      const stale = signer.sign('hello', alice);

      await signer.verify('hello', stale, alicePublicKey);
      expect(seenNonceCount(signer)).toBe(0);
    });
  });

  describe('replay protection with a StorageProvider', () => {
    it('rejects a replay across a restart (new instance, same storage)', async () => {
      const storage = new InMemoryStorage();
      const original = new MessageSigner(storage);

      const envelope = original.sign('hello', alice);
      expect((await original.verify('hello', envelope, alicePublicKey)).valid).toBe(true);

      const restarted = new MessageSigner(storage);
      const replay = await restarted.verify('hello', envelope, alicePublicKey);
      expect(replay.valid).toBe(false);
      expect(replay.reason).toMatch(/Replay detected/);
    });

    it('accepts an envelope exactly once when two verifiers race on it concurrently', async () => {
      const storage = new InMemoryStorage();
      const processA = new MessageSigner(storage);
      const processB = new MessageSigner(storage);
      const envelope = processA.sign('hello', alice);

      const results = await Promise.all([
        processA.verify('hello', envelope, alicePublicKey),
        processB.verify('hello', envelope, alicePublicKey),
        processA.verify('hello', envelope, alicePublicKey)
      ]);

      expect(results.filter(r => r.valid)).toHaveLength(1);
      expect(results.filter(r => r.reason?.match(/Replay detected/))).toHaveLength(2);
    });

    it('claims the nonce via setIfNotExists with a TTL matching the validity window', async () => {
      const storage = new InMemoryStorage();
      const spy = jest.spyOn(storage, 'setIfNotExists');
      const storageSigner = new MessageSigner(storage);
      const envelope = storageSigner.sign('hello', alice);

      await storageSigner.verify('hello', envelope, alicePublicKey, { maxAgeMs: 60_000 });

      expect(spy).toHaveBeenCalledTimes(1);
      const [key, value, ttlMs] = spy.mock.calls[0];
      expect(key).toContain(envelope.nonce);
      expect(value).toBe('1');
      expect(ttlMs).toBeGreaterThan(0);
      expect(ttlMs).toBeLessThanOrEqual(60_000);
    });

    it('documents replay window reopens on restart without persistence', async () => {
      const original = new MessageSigner();
      const envelope = original.sign('hello', alice);
      expect((await original.verify('hello', envelope, alicePublicKey)).valid).toBe(true);

      // Known limitation: a fresh in-memory signer has no nonce history, so
      // the same envelope is accepted again while its timestamp is in window.
      const restarted = new MessageSigner();
      expect((await restarted.verify('hello', envelope, alicePublicKey)).valid).toBe(true);
    });
  });
});
