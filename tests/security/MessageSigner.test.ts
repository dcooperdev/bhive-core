import { MessageSigner } from '../../src/security/MessageSigner';
import { BeeIdentityManager } from '../../src/bee/BeeIdentityManager';
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
});
