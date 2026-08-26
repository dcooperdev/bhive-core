import { randomUUID } from 'crypto';
import { AuditEntry, AuditEventType } from '../types';
import { StorageProvider } from '../providers/StorageProvider';

export type AuditRecordInput = Omit<AuditEntry, 'id' | 'timestamp'>;

/**
 * AuditLog - append-only record of every security-relevant event: a
 * message sent or received, a signature verification, a detected
 * injection attempt, a rate limit hit, an unauthorized delegation.
 * Persisted through a StorageProvider when given, so the trail survives
 * restarts and can be centralized (e.g. in Redis); otherwise kept
 * in-memory for the life of the process.
 */
export class AuditLog {
  constructor(
    private storageProvider?: StorageProvider,
    private key: string = 'hive:audit-log'
  ) {}

  private localEntries: AuditEntry[] = [];

  async record(entry: AuditRecordInput): Promise<AuditEntry> {
    const full: AuditEntry = { id: randomUUID(), timestamp: new Date(), ...entry };

    if (this.storageProvider) {
      await this.storageProvider.pushToList(this.key, full);
    } else {
      this.localEntries.push(full);
    }

    return full;
  }

  /** Every recorded entry, oldest first, optionally filtered by Bee name and/or capped to the most recent `limit`. */
  async getAuditHistory(beeName?: string, limit?: number): Promise<AuditEntry[]> {
    const all = this.storageProvider
      ? await this.storageProvider.getList<AuditEntry>(this.key)
      : [...this.localEntries];

    const filtered = beeName ? all.filter(entry => entry.beeName === beeName) : all;

    return limit !== undefined ? filtered.slice(-limit) : filtered;
  }

  /** The full audit trail as a JSON string, suitable for export/archival. */
  async exportAuditTrail(): Promise<string> {
    return JSON.stringify(await this.getAuditHistory(), null, 2);
  }

  /** Convenience filter over a single event type across the whole trail. */
  async getEntriesByType(type: AuditEventType): Promise<AuditEntry[]> {
    const all = await this.getAuditHistory();
    return all.filter(entry => entry.type === type);
  }
}
