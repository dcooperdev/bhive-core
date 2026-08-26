import {
  AttestationChainService,
  verifyAttestationChain,
  GENESIS_HASH
} from '../../src/security/AttestationChain';
import { InMemoryStorage } from '../../src/storage/InMemoryStorage';
import { AttestationChain } from '../../src/types';

function makeInput(overrides: Partial<Parameters<AttestationChainService['append']>[0]> = {}) {
  return {
    messageId: 'msg-1',
    from: 'a',
    to: 'b',
    timestamp: Date.now(),
    signature: 'sig-1',
    ...overrides
  };
}

describe('verifyAttestationChain', () => {
  it('should accept an empty chain', () => {
    expect(verifyAttestationChain([])).toBe(true);
  });

  it('should accept a valid single-link chain', async () => {
    const service = new AttestationChainService();
    const entry = await service.append(makeInput());

    expect(verifyAttestationChain([entry])).toBe(true);
    expect(entry.previousHash).toBe(GENESIS_HASH);
  });

  it('should accept a valid multi-link chain', async () => {
    const service = new AttestationChainService();
    await service.append(makeInput({ messageId: 'msg-1' }));
    await service.append(makeInput({ messageId: 'msg-2' }));
    await service.append(makeInput({ messageId: 'msg-3' }));

    const chain = await service.getChain();
    expect(verifyAttestationChain(chain)).toBe(true);
  });

  it('should throw when a hash has been tampered with', async () => {
    const service = new AttestationChainService();
    const entry = await service.append(makeInput());
    const tampered: AttestationChain = { ...entry, hash: 'f'.repeat(64) };

    expect(() => verifyAttestationChain([tampered])).toThrow(/tampering detected/);
  });

  it('should throw when a record\'s content was altered without recomputing its hash', async () => {
    const service = new AttestationChainService();
    const entry = await service.append(makeInput());
    const tampered: AttestationChain = { ...entry, from: 'attacker' };

    expect(() => verifyAttestationChain([tampered])).toThrow(/tampering detected/);
  });

  it('should throw when a link in the middle is removed (broken chain)', async () => {
    const service = new AttestationChainService();
    await service.append(makeInput({ messageId: 'msg-1' }));
    await service.append(makeInput({ messageId: 'msg-2' }));
    await service.append(makeInput({ messageId: 'msg-3' }));

    const chain = await service.getChain();
    const withGap = [chain[0], chain[2]]; // drop msg-2

    expect(() => verifyAttestationChain(withGap)).toThrow(/previousHash/);
  });

  it('should throw when the chain is reordered', async () => {
    const service = new AttestationChainService();
    await service.append(makeInput({ messageId: 'msg-1' }));
    await service.append(makeInput({ messageId: 'msg-2' }));

    const chain = await service.getChain();
    const reordered = [chain[1], chain[0]];

    expect(() => verifyAttestationChain(reordered)).toThrow();
  });
});

describe('AttestationChainService', () => {
  it('should default to an in-memory chain when no storageProvider is given', async () => {
    const service = new AttestationChainService();
    await service.append(makeInput());

    expect(await service.getChain()).toHaveLength(1);
  });

  it('should persist the chain through a StorageProvider when given', async () => {
    const storage = new InMemoryStorage();
    const service = new AttestationChainService(storage, 'my-channel');

    await service.append(makeInput());

    expect(await storage.getList('my-channel')).toHaveLength(1);
  });

  it('should link each new attestation to the previous one\'s hash', async () => {
    const service = new AttestationChainService();
    const first = await service.append(makeInput({ messageId: 'msg-1' }));
    const second = await service.append(makeInput({ messageId: 'msg-2' }));

    expect(second.previousHash).toBe(first.hash);
  });

  it('should expose verify() as a convenience over getChain() + verifyAttestationChain()', async () => {
    const service = new AttestationChainService();
    await service.append(makeInput());

    await expect(service.verify()).resolves.toBe(true);
  });

  it('should let verify() detect tampering when reading from shared storage', async () => {
    const storage = new InMemoryStorage();
    const service = new AttestationChainService(storage, 'shared');
    const entry = await service.append(makeInput());

    await storage.clearList('shared');
    await storage.pushToList('shared', { ...entry, from: 'attacker' });

    await expect(service.verify()).rejects.toThrow(/tampering detected/);
  });
});
