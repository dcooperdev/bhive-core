import {
  createSecureMessage,
  isSecureMessage,
  openSecureMessage,
  sealSecureMessage,
  SecurityError,
  signedContent
} from '../../src/security/SecureMessage';
import { MessageSigner } from '../../src/security/MessageSigner';
import { BeeIdentityManager } from '../../src/bee/BeeIdentityManager';
import { BeeKeyring } from '../../src/bee/BeeKeyring';

describe('createSecureMessage', () => {
  it('should build an unsigned, unencrypted envelope', () => {
    const message = createSecureMessage('classifier', 'responder', 'draft a reply');

    expect(message.from).toBe('classifier');
    expect(message.to).toBe('responder');
    expect(message.data).toBe('draft a reply');
    expect(message.id).toEqual(expect.any(String));
    expect(message.timestamp).toBeLessThanOrEqual(Date.now());
    expect(message.signature).toBeUndefined();
    expect(message.encrypted).toBeUndefined();
  });
});

describe('isSecureMessage', () => {
  it('should accept a well-formed message', () => {
    expect(isSecureMessage(createSecureMessage('a', 'b', 'task'))).toBe(true);
  });

  it('should reject null and non-objects', () => {
    expect(isSecureMessage(null)).toBe(false);
    expect(isSecureMessage('a string')).toBe(false);
    expect(isSecureMessage(42)).toBe(false);
  });

  it('should reject an object missing required fields', () => {
    expect(isSecureMessage({ id: '1', from: 'a' })).toBe(false);
  });

  it('should reject an object with the wrong field types', () => {
    expect(isSecureMessage({ id: '1', from: 'a', to: 'b', timestamp: 'not-a-number' })).toBe(false);
  });
});

describe('SecurityError', () => {
  it('should be a distinguishable Error subtype', () => {
    const error = new SecurityError('signature invalid');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('SecurityError');
    expect(error.message).toBe('signature invalid');
  });
});

describe('sealSecureMessage / openSecureMessage', () => {
  let registry: BeeIdentityManager;
  let alice: BeeKeyring;
  let bob: BeeKeyring;

  beforeEach(() => {
    registry = new BeeIdentityManager();
    alice = registry.registerBeeIdentity('alice');
    bob = registry.registerBeeIdentity('bob');
  });

  afterEach(() => {
    alice.destroy();
    bob.destroy();
  });

  const bobPublic = () => registry.getBeeIdentity('bob')!;
  const alicePublicKey = () => registry.getBeeIdentity('alice')!.signingPublicKey;

  describe('signed + encrypted', () => {
    it('does not expose the signature anywhere in the encrypted envelope', () => {
      const message = sealSecureMessage(alice, bobPublic(), 'approve', { sign: true, encrypt: true });
      const opened = openSecureMessage(bob, message);

      // The signature exists (the recipient recovers it)...
      expect(opened.signature).toEqual(expect.any(String));
      // ...but only inside the ciphertext: no field, and no substring of the wire form, carries it.
      expect(message.signature).toBeUndefined();
      expect(JSON.stringify(message)).not.toContain(opened.signature!);
      // Nonce and timestamp stay outside; they reveal nothing without the signature.
      expect(message.nonce).toEqual(expect.any(String));
    });

    it('defeats offline guessing: no value on the wire verifies a correctly guessed low-entropy payload', async () => {
      const message = sealSecureMessage(alice, bobPublic(), 'approve', { sign: true, encrypt: true });
      const opened = openSecureMessage(bob, message);
      const guess = signedContent(message.id, message.from, message.to, 'approve'); // the right guess
      const verifier = () => new MessageSigner(); // fresh each time: no nonce state between attempts

      // Control: had the signature been visible, it would confirm the guess.
      const withLeakedSignature = await verifier().verify(
        guess,
        { signature: opened.signature!, nonce: message.nonce!, timestamp: message.timestamp },
        alicePublicKey()
      );
      expect(withLeakedSignature.valid).toBe(true);

      // What an eavesdropper actually has: every string on the wire. None of them confirms the guess.
      const wireValues = Object.values(message).filter((v): v is string => typeof v === 'string');
      for (const candidateSignature of wireValues) {
        const result = await verifier().verify(
          guess,
          { signature: candidateSignature, nonce: message.nonce!, timestamp: message.timestamp },
          alicePublicKey()
        );
        expect(result.valid).toBe(false);
      }
    });

    it('recovers the original plaintext and a signature over {id, from, to, data}', async () => {
      const message = sealSecureMessage(alice, bobPublic(), { task: 'label', id: 7 }, { sign: true, encrypt: true });
      const opened = openSecureMessage(bob, message);

      expect(opened.data).toEqual({ task: 'label', id: 7 });
      const result = await new MessageSigner().verify(
        signedContent(message.id, 'alice', 'bob', opened.data),
        { signature: opened.signature!, nonce: message.nonce!, timestamp: message.timestamp },
        alicePublicKey()
      );
      expect(result.valid).toBe(true);
    });

    it('rejects an encrypted message that also carries an outer signature', () => {
      const message = sealSecureMessage(alice, bobPublic(), 'approve', { sign: true, encrypt: true });
      const opened = openSecureMessage(bob, message);

      expect(() => openSecureMessage(bob, { ...message, signature: opened.signature })).toThrow(
        /must not carry a signature outside the ciphertext/
      );
    });
  });

  describe('encrypted only', () => {
    it('round-trips with no signature', () => {
      const message = sealSecureMessage(alice, bobPublic(), 'hello', { encrypt: true });
      expect(openSecureMessage(bob, message)).toEqual({ data: 'hello', signature: undefined });
    });
  });

  describe('signed only (unchanged)', () => {
    it('keeps the plaintext and the signature in the clear', () => {
      const message = sealSecureMessage(alice, bobPublic(), 'hello', { sign: true });

      expect(message.encrypted).toBeUndefined();
      expect(message.data).toBe('hello');
      expect(message.signature).toEqual(expect.any(String));
      expect(openSecureMessage(bob, message)).toEqual({ data: 'hello', signature: message.signature });
    });
  });
});
