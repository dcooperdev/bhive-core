import { MessageSigner } from '../../src/security/MessageSigner';
import { BeeIdentityManager } from '../../src/bee/BeeIdentityManager';
import { InMemoryStorage } from '../../src/storage/InMemoryStorage';
import { BeeIdentity } from '../../src/types';

describe('MessageSigner', () => {
  let signer: MessageSigner;
  let alice: BeeIdentity;
  let bob: BeeIdentity;

  beforeEach(() => {
    signer = new MessageSigner();
    const manager = new BeeIdentityManager();
    alice = manager.registerBeeIdentity('alice');
    bob = manager.registerBeeIdentity('bob');
  });

  describe('sign', () => {
    it('should produce a signature, nonce, and timestamp', () => {
      const envelope = signer.sign('hello', alice);

      expect(envelope.signature).toEqual(expect.any(String));
      expect(envelope.signature.length).toBeGreaterThan(0);
      expect(envelope.nonce).toEqual(expect.any(String));
      expect(envelope.timestamp).toBeLessThanOrEqual(Date.now());
    });

    it('should produce a different nonce on every call', () => {
      const first = signer.sign('hello', alice);
      const second = signer.sign('hello', alice);

      expect(first.nonce).not.toBe(second.nonce);
      expect(first.signature).not.toBe(second.signature);
    });
  });

  describe('verify', () => {
    it('should accept a correctly signed message', () => {
      const envelope = signer.sign('hello', alice);
      expect(signer.verify('hello', envelope, alice)).toEqual({ valid: true });
    });

    it('should reject when the data has been tampered with', () => {
      const envelope = signer.sign('hello', alice);
      const result = signer.verify('goodbye', envelope, alice);

      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/Invalid signature/);
    });

    it('should reject when the signature itself has been tampered with', () => {
      const envelope = signer.sign('hello', alice);
      const result = signer.verify('hello', { ...envelope, signature: '00'.repeat(32) }, alice);

      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/Invalid signature/);
    });

    it('should reject a signature produced with a different identity', () => {
      const envelope = signer.sign('hello', alice);
      const result = signer.verify('hello', envelope, bob);

      expect(result.valid).toBe(false);
    });

    it('should reject a signature of a different length without throwing', () => {
      const envelope = signer.sign('hello', alice);
      const result = signer.verify('hello', { ...envelope, signature: 'ab' }, alice);

      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/Invalid signature/);
    });

    it('should reject the same nonce on a second verification (replay attack)', () => {
      const envelope = signer.sign('hello', alice);

      expect(signer.verify('hello', envelope, alice).valid).toBe(true);

      const replay = signer.verify('hello', envelope, alice);
      expect(replay.valid).toBe(false);
      expect(replay.reason).toMatch(/Replay detected/);
    });

    it('should reject a message whose timestamp is outside the allowed window', () => {
      // Sign "in the past" so the envelope is genuinely, validly old - the
      // signature covers the timestamp, so we can't just mutate it after
      // the fact without also invalidating the signature.
      const realNow = Date.now;
      const tenMinutesAgo = realNow() - 10 * 60_000;
      Date.now = jest.fn(() => tenMinutesAgo);
      const envelope = signer.sign('hello', alice);
      Date.now = realNow;

      const result = signer.verify('hello', envelope, alice, { maxAgeMs: 5 * 60_000 });

      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/timestamp/i);
    });

    it('should accept a custom maxAgeMs window', () => {
      const envelope = signer.sign('hello', alice);
      expect(signer.verify('hello', envelope, alice, { maxAgeMs: 1 }).valid).toBe(true);
    });

    it('should forget nonces after resetNonceHistory()', () => {
      const envelope = signer.sign('hello', alice);
      signer.verify('hello', envelope, alice);
      signer.resetNonceHistory();

      // Signature/timestamp are still valid, only nonce-replay state was cleared.
      expect(signer.verify('hello', envelope, alice).valid).toBe(true);
    });
  });

  describe('nonce eviction', () => {
    const seenNonceCount = (s: MessageSigner): number =>
      (s as unknown as { seenNonces: Map<string, number> }).seenNonces.size;

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('evicts expired nonces so history does not grow unbounded', () => {
      const maxAgeMs = 60_000;
      let now = 1_000_000;
      jest.spyOn(Date, 'now').mockImplementation(() => now);

      for (let i = 0; i < 50; i++) {
        const envelope = signer.sign({ i }, alice);
        expect(signer.verify({ i }, envelope, alice, { maxAgeMs }).valid).toBe(true);
      }
      expect(seenNonceCount(signer)).toBe(50);

      now += maxAgeMs + 1;

      for (let i = 0; i < 5; i++) {
        const envelope = signer.sign({ fresh: i }, alice);
        expect(signer.verify({ fresh: i }, envelope, alice, { maxAgeMs }).valid).toBe(true);
      }
      // The 50 expired nonces were evicted; only the 5 fresh ones remain.
      expect(seenNonceCount(signer)).toBe(5);
    });

    it('still rejects a replay of an unexpired nonce after eviction passes', () => {
      const envelope = signer.sign('hello', alice);
      expect(signer.verify('hello', envelope, alice).valid).toBe(true);

      const other = signer.sign('other', alice);
      expect(signer.verify('other', other, alice).valid).toBe(true);

      expect(signer.verify('hello', envelope, alice).reason).toMatch(/Replay detected/);
    });
  });

  describe('nonce persistence', () => {
    it('rejects a replay across a restart when a StorageProvider is passed', async () => {
      const storage = new InMemoryStorage();
      const original = new MessageSigner(storage);
      await original.ready;

      const envelope = original.sign('hello', alice);
      expect(original.verify('hello', envelope, alice).valid).toBe(true);
      await original.flushNoncePersistence();

      const restarted = new MessageSigner(storage);
      await restarted.ready;

      const replay = restarted.verify('hello', envelope, alice);
      expect(replay.valid).toBe(false);
      expect(replay.reason).toMatch(/Replay detected/);
    });

    it('keeps nonces from several signers sharing the same StorageProvider', async () => {
      const storage = new InMemoryStorage();
      const first = new MessageSigner(storage);
      const second = new MessageSigner(storage);
      await Promise.all([first.ready, second.ready]);

      const a = first.sign('a', alice);
      const b = second.sign('b', alice);
      first.verify('a', a, alice);
      second.verify('b', b, alice);
      await Promise.all([first.flushNoncePersistence(), second.flushNoncePersistence()]);

      const restarted = new MessageSigner(storage);
      await restarted.ready;
      expect(restarted.verify('a', a, alice).reason).toMatch(/Replay detected/);
      expect(restarted.verify('b', b, alice).reason).toMatch(/Replay detected/);
    });

    it('does not reload expired nonces from storage', async () => {
      const storage = new InMemoryStorage();
      const original = new MessageSigner(storage);
      const envelope = original.sign('hello', alice);
      original.verify('hello', envelope, alice, { maxAgeMs: 1_000 });
      await original.flushNoncePersistence();

      const realNow = Date.now();
      const spy = jest.spyOn(Date, 'now').mockImplementation(() => realNow + 5_000);
      const restarted = new MessageSigner(storage);
      await restarted.ready;
      expect((restarted as unknown as { seenNonces: Map<string, number> }).seenNonces.size).toBe(0);
      spy.mockRestore();
    });

    it('documents replay window reopens on restart without persistence', () => {
      const original = new MessageSigner();
      const envelope = original.sign('hello', alice);
      expect(original.verify('hello', envelope, alice).valid).toBe(true);

      // Known limitation: a fresh in-memory signer has no nonce history, so
      // the same envelope is accepted again while its timestamp is in window.
      const restarted = new MessageSigner();
      expect(restarted.verify('hello', envelope, alice).valid).toBe(true);
    });
  });
});
