import { AuditLog } from '../../src/security/AuditLog';
import { InMemoryStorage } from '../../src/storage/InMemoryStorage';

describe('AuditLog', () => {
  describe('in-memory (no storageProvider)', () => {
    it('should record an entry with a generated id and timestamp', async () => {
      const log = new AuditLog();
      const entry = await log.record({ beeName: 'classifier', type: 'message_sent', detail: 'to responder' });

      expect(entry.id).toEqual(expect.any(String));
      expect(entry.timestamp).toBeInstanceOf(Date);
      expect(entry.beeName).toBe('classifier');
      expect(entry.type).toBe('message_sent');
    });

    it('should return recorded entries in order via getAuditHistory', async () => {
      const log = new AuditLog();
      await log.record({ beeName: 'a', type: 'message_sent', detail: '1' });
      await log.record({ beeName: 'a', type: 'message_received', detail: '2' });

      const history = await log.getAuditHistory();
      expect(history.map(e => e.detail)).toEqual(['1', '2']);
    });

    it('should filter by beeName', async () => {
      const log = new AuditLog();
      await log.record({ beeName: 'a', type: 'message_sent', detail: '1' });
      await log.record({ beeName: 'b', type: 'message_sent', detail: '2' });

      const history = await log.getAuditHistory('a');
      expect(history).toHaveLength(1);
      expect(history[0].beeName).toBe('a');
    });

    it('should cap results to the most recent `limit` entries', async () => {
      const log = new AuditLog();
      await log.record({ beeName: 'a', type: 'message_sent', detail: '1' });
      await log.record({ beeName: 'a', type: 'message_sent', detail: '2' });
      await log.record({ beeName: 'a', type: 'message_sent', detail: '3' });

      const history = await log.getAuditHistory(undefined, 2);
      expect(history.map(e => e.detail)).toEqual(['2', '3']);
    });

    it('should export the full trail as JSON', async () => {
      const log = new AuditLog();
      await log.record({ beeName: 'a', type: 'message_sent', detail: '1' });

      const exported = await log.exportAuditTrail();
      const parsed = JSON.parse(exported);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].detail).toBe('1');
    });

    it('should filter by event type', async () => {
      const log = new AuditLog();
      await log.record({ beeName: 'a', type: 'message_sent', detail: '1' });
      await log.record({ beeName: 'a', type: 'injection_detected', detail: '2' });

      const injections = await log.getEntriesByType('injection_detected');
      expect(injections).toHaveLength(1);
      expect(injections[0].detail).toBe('2');
    });

    it('should carry optional metadata through', async () => {
      const log = new AuditLog();
      await log.record({
        beeName: 'a',
        type: 'injection_detected',
        detail: 'risk=0.9',
        metadata: { patterns: ['ignore.*instructions'] }
      });

      const [entry] = await log.getAuditHistory();
      expect(entry.metadata).toEqual({ patterns: ['ignore.*instructions'] });
    });
  });

  describe('storage-backed', () => {
    it('should persist entries through the given StorageProvider', async () => {
      const storage = new InMemoryStorage();
      const log = new AuditLog(storage, 'my-audit-log');

      await log.record({ beeName: 'a', type: 'message_sent', detail: '1' });

      expect(await storage.getList('my-audit-log')).toHaveLength(1);
    });

    it('should read history back from the shared StorageProvider', async () => {
      const storage = new InMemoryStorage();
      const logA = new AuditLog(storage, 'shared-log');
      const logB = new AuditLog(storage, 'shared-log');

      await logA.record({ beeName: 'a', type: 'message_sent', detail: 'from A' });

      const history = await logB.getAuditHistory();
      expect(history).toHaveLength(1);
      expect(history[0].detail).toBe('from A');
    });
  });
});
