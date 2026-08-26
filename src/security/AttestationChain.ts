import { createHash } from 'crypto';
import { AttestationChain } from '../types';
import { StorageProvider } from '../providers/StorageProvider';

export const GENESIS_HASH = '0'.repeat(64);

export interface AttestationInput {
  messageId: string;
  from: string;
  to: string;
  timestamp: number;
  signature: string;
}

function computeHash(record: Omit<AttestationChain, 'hash'>): string {
  const canonical = JSON.stringify({
    messageId: record.messageId,
    from: record.from,
    to: record.to,
    timestamp: record.timestamp,
    signature: record.signature,
    previousHash: record.previousHash
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Verifies that every link in an attestation chain follows correctly
 * from the one before it (hash(record[i]) === record[i+1].previousHash)
 * and that no record's stored hash has been altered. Throws on the
 * first break found; returns true if the whole chain is intact.
 */
export function verifyAttestationChain(chain: AttestationChain[]): true {
  let expectedPrevious = GENESIS_HASH;

  for (const entry of chain) {
    if (entry.previousHash !== expectedPrevious) {
      throw new Error(
        `Attestation chain broken at message "${entry.messageId}": expected previousHash "${expectedPrevious}", got "${entry.previousHash}"`
      );
    }

    const recomputedHash = computeHash(entry);
    if (recomputedHash !== entry.hash) {
      throw new Error(
        `Attestation chain broken at message "${entry.messageId}": stored hash does not match its content (tampering detected)`
      );
    }

    expectedPrevious = entry.hash;
  }

  return true;
}

/**
 * AttestationChainService - appends signed-message attestations to a
 * hash chain, optionally persisted through a StorageProvider so the
 * chain survives restarts and can be shared/audited across instances.
 * Falls back to an in-memory array when no StorageProvider is given.
 */
export class AttestationChainService {
  constructor(
    private storageProvider?: StorageProvider,
    private channelKey: string = 'hive:attestations'
  ) {}

  private localChain: AttestationChain[] = [];

  async append(input: AttestationInput): Promise<AttestationChain> {
    const chain = await this.getChain();
    const previousHash = chain.length > 0 ? chain[chain.length - 1].hash : GENESIS_HASH;
    const hash = computeHash({ ...input, previousHash });
    const attestation: AttestationChain = { ...input, previousHash, hash };

    if (this.storageProvider) {
      await this.storageProvider.pushToList(this.channelKey, attestation);
    } else {
      this.localChain.push(attestation);
    }

    return attestation;
  }

  async getChain(): Promise<AttestationChain[]> {
    if (this.storageProvider) {
      return this.storageProvider.getList<AttestationChain>(this.channelKey);
    }
    return [...this.localChain];
  }

  async verify(): Promise<true> {
    return verifyAttestationChain(await this.getChain());
  }
}
