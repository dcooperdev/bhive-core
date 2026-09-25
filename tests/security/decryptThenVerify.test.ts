import { BeeManager } from '../../src/bee/BeeManager';
import { BeeIdentityManager } from '../../src/bee/BeeIdentityManager';
import { BeeKeyring } from '../../src/bee/BeeKeyring';
import { sealSecureMessage } from '../../src/security/SecureMessage';
import { SecureAgentMessage } from '../../src/types';
import { MockLLM } from '../__mocks__/MockLLM';

/**
 * End-to-end: signed + encrypted delegation where the signature is sealed
 * inside the ciphertext, so BeeManager.verifyIncomingMessage() must decrypt
 * first and only then verify. Legitimate messages must still pass; every
 * alteration must be rejected at the right step; and signature
 * verification must never run before the plaintext exists.
 */
describe('decrypt-then-verify (signed + encrypted messages)', () => {
  let beeManager: BeeManager;
  let attackerKeyring: BeeKeyring;

  const responderPublic = () => beeManager.getIdentityManager().getBeeIdentity('responder')!;
  const seal = (data: unknown): SecureAgentMessage =>
    beeManager.getBee('classifier')!.sealMessage(responderPublic(), data, { sign: true, encrypt: true });
  const verify = (message: SecureAgentMessage, from = 'classifier', to = 'responder') =>
    beeManager.verifyIncomingMessage(message, from, to);

  const b64Flip = (value: string): string => {
    const bytes = Buffer.from(value, 'base64');
    bytes[bytes.length - 1] ^= 1;
    return bytes.toString('base64');
  };

  beforeEach(() => {
    beeManager = new BeeManager('gemini-1.5-flash', {
      apiKey: 'test-api-key',
      securityOptions: { enableSigning: true, enableEncryption: true }
    });
    beeManager.createBee({ name: 'classifier', prompt: 'Classify', tools: [], llmAdapter: new MockLLM() });
    beeManager.createBee({ name: 'responder', prompt: 'Respond', tools: [], llmAdapter: new MockLLM() });

    // An outsider who calls itself "classifier" but holds a different key.
    attackerKeyring = new BeeIdentityManager().registerBeeIdentity('classifier');
  });

  afterEach(() => {
    attackerKeyring.destroy();
    jest.restoreAllMocks();
  });

  describe('legitimate messages', () => {
    it('are decrypted, verified, and returned as plaintext', async () => {
      await expect(verify(seal('Draft a reply'))).resolves.toBe('Draft a reply');
    });

    it('flow through a full delegation to the target Bee', async () => {
      const responderLLM = new MockLLM();
      beeManager.createBee({ name: 'drafter', prompt: 'Draft', tools: [], llmAdapter: responderLLM });
      responderLLM.respondOnceWith({ content: 'Drafted', toolCalls: [] });

      await expect(beeManager.delegateToAgent('classifier', 'drafter', 'Write the draft')).resolves.toBe('Drafted');
      expect(beeManager.getBee('drafter')!.getRuns()[0].input).toBe('Write the draft');
      expect(beeManager.getDelegationHistory().slice(-1)[0].secureMessage!.signature).toBeUndefined();
    });

    it('decrypt strictly before verify, every time', async () => {
      const openSpy = jest.spyOn(beeManager.getBee('responder')!, 'openMessage');
      const verifySpy = jest.spyOn(beeManager.getMessageSigner(), 'verify');

      await verify(seal('Draft a reply'));

      expect(openSpy).toHaveBeenCalledTimes(1);
      expect(verifySpy).toHaveBeenCalledTimes(1);
      expect(openSpy.mock.invocationCallOrder[0]).toBeLessThan(verifySpy.mock.invocationCallOrder[0]);
      // And verify() received the signature recovered from inside the ciphertext.
      const recovered = openSpy.mock.results[0].value as { signature: string };
      expect(verifySpy.mock.calls[0][1].signature).toBe(recovered.signature);
    });
  });

  describe('envelope tampering fails at decryption, before any signature check', () => {
    const tamperings: Array<[string, (m: SecureAgentMessage) => SecureAgentMessage]> = [
      ['ciphertext', m => ({ ...m, data: b64Flip(m.data as string) })],
      ['iv', m => ({ ...m, iv: b64Flip(m.iv!) })],
      ['authTag', m => ({ ...m, authTag: b64Flip(m.authTag!) })],
      ['ephemeralPublicKey', m => ({ ...m, ephemeralPublicKey: seal('other').ephemeralPublicKey })],
      ['encryptionKeyId', m => ({ ...m, encryptionKeyId: 'not-a-real-key-id' })],
      ['outer signature injected', m => ({ ...m, signature: 'AAAA' })]
    ];

    it.each(tamperings)('rejects a tampered %s and never calls verify()', async (_field, tamper) => {
      const verifySpy = jest.spyOn(beeManager.getMessageSigner(), 'verify');

      await expect(verify(tamper(seal('Draft a reply')))).rejects.toThrow(/Decryption failed/);
      expect(verifySpy).not.toHaveBeenCalled();
    });
  });

  describe('signed-field tampering and forgery fail at verification, after decryption', () => {
    it('rejects a changed message id (id is now signed)', async () => {
      await expect(verify({ ...seal('Draft a reply'), id: 'another-id' })).rejects.toThrow(/Invalid signature/);
    });

    it('rejects a changed nonce or timestamp', async () => {
      await expect(verify({ ...seal('x'), nonce: 'f'.repeat(32) })).rejects.toThrow(/Invalid signature/);
      const message = seal('x');
      await expect(verify({ ...message, timestamp: message.timestamp + 1 })).rejects.toThrow(/Invalid signature/);
    });

    it('rejects a message attributed to a different sender', async () => {
      beeManager.createBee({ name: 'executor', prompt: 'Execute', tools: [], llmAdapter: new MockLLM() });
      await expect(verify(seal('Draft a reply'), 'executor')).rejects.toThrow(/Invalid signature/);
    });

    it('rejects a well-formed encrypted message whose sealed signature comes from the wrong key', async () => {
      // Valid GCM (anyone can encrypt to responder's public key), forged inner signature.
      const forged = sealSecureMessage(attackerKeyring, responderPublic(), 'transfer everything', {
        sign: true,
        encrypt: true
      });

      await expect(verify(forged)).rejects.toThrow(/Invalid signature/);
    });

    it('rejects an encrypted message with no signature inside when signing is required (no downgrade)', async () => {
      const unsigned = sealSecureMessage(attackerKeyring, responderPublic(), 'transfer everything', { encrypt: true });

      await expect(verify(unsigned)).rejects.toThrow(/unsigned but signing is required/);
    });

    it('rejects a replay of a legitimate message', async () => {
      const message = seal('Draft a reply');

      await expect(verify(message)).resolves.toBe('Draft a reply');
      await expect(verify(message)).rejects.toThrow(/Replay detected/);
    });
  });

  describe('signed-only messages are unchanged', () => {
    it('verify the clear-text signature without any decryption step', async () => {
      const signingOnly = new BeeManager('gemini-1.5-flash', {
        apiKey: 'test-api-key',
        securityOptions: { enableSigning: true }
      });
      signingOnly.createBee({ name: 'classifier', prompt: 'Classify', tools: [], llmAdapter: new MockLLM() });
      signingOnly.createBee({ name: 'responder', prompt: 'Respond', tools: [], llmAdapter: new MockLLM() });

      const recipient = signingOnly.getIdentityManager().getBeeIdentity('responder')!;
      const message = signingOnly.getBee('classifier')!.sealMessage(recipient, 'hello', { sign: true });
      const openSpy = jest.spyOn(signingOnly.getBee('responder')!, 'openMessage');

      expect(message.signature).toEqual(expect.any(String));
      await expect(signingOnly.verifyIncomingMessage(message, 'classifier', 'responder')).resolves.toBe('hello');
      expect(openSpy).not.toHaveBeenCalled();
    });
  });
});
