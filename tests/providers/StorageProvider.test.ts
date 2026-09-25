import { StorageProvider } from '../../src/providers/StorageProvider';
import { InMemoryStorage } from '../../src/storage/InMemoryStorage';

/**
 * Contract test: any StorageProvider implementation must satisfy this
 * shared behavior regardless of which backend it wraps.
 */
function describeStorageProviderContract(providerName: string, factory: () => StorageProvider) {
  describe(`StorageProvider contract: ${providerName}`, () => {
    let storage: StorageProvider;

    beforeEach(() => {
      storage = factory();
    });

    describe('setIfNotExists', () => {
      it('should set the key and return true on the first call', async () => {
        expect(await storage.setIfNotExists('nonce', '1', 1_000)).toBe(true);
        expect(await storage.get('nonce')).toBe('1');
      });

      it('should return false and not overwrite on a second call before the TTL', async () => {
        await storage.setIfNotExists('nonce', 'first', 1_000);

        expect(await storage.setIfNotExists('nonce', 'second', 1_000)).toBe(false);
        expect(await storage.get('nonce')).toBe('first');
      });

      it('should return false for a key already set via set()', async () => {
        await storage.set('nonce', 'existing');
        expect(await storage.setIfNotExists('nonce', '1', 1_000)).toBe(false);
      });

      it('should return true again once the TTL has expired', async () => {
        await storage.setIfNotExists('nonce', 'first', 10);
        await new Promise(resolve => setTimeout(resolve, 20));

        expect(await storage.setIfNotExists('nonce', 'second', 1_000)).toBe(true);
        expect(await storage.get('nonce')).toBe('second');
      });

      it('should let exactly one of many concurrent callers win', async () => {
        const results = await Promise.all(Array.from({ length: 20 }, () => storage.setIfNotExists('nonce', '1', 1_000)));
        expect(results.filter(Boolean)).toHaveLength(1);
      });
    });

    describe('key/value', () => {
      it('should return undefined for a missing key', async () => {
        expect(await storage.get('missing')).toBeUndefined();
        expect(await storage.has('missing')).toBe(false);
      });

      it('should set and get a value', async () => {
        await storage.set('foo', { a: 1 });
        expect(await storage.get('foo')).toEqual({ a: 1 });
        expect(await storage.has('foo')).toBe(true);
      });

      it('should delete a value', async () => {
        await storage.set('foo', 'bar');
        await storage.delete('foo');
        expect(await storage.get('foo')).toBeUndefined();
      });

      it('should expire a value after its TTL', async () => {
        await storage.set('foo', 'bar', 10);
        expect(await storage.get('foo')).toBe('bar');

        await new Promise(resolve => setTimeout(resolve, 20));

        expect(await storage.get('foo')).toBeUndefined();
        expect(await storage.has('foo')).toBe(false);
      });

      it('should not expire a value with no TTL', async () => {
        await storage.set('foo', 'bar');
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(await storage.get('foo')).toBe('bar');
      });
    });

    describe('lists', () => {
      it('should report zero length for an unknown list', async () => {
        expect(await storage.listLength('queue')).toBe(0);
      });

      it('should push and pop in FIFO order', async () => {
        await storage.pushToList('queue', 'first');
        await storage.pushToList('queue', 'second');

        expect(await storage.listLength('queue')).toBe(2);
        expect(await storage.popFromList('queue')).toBe('first');
        expect(await storage.popFromList('queue')).toBe('second');
        expect(await storage.popFromList('queue')).toBeUndefined();
      });

      it('should clear a list', async () => {
        await storage.pushToList('queue', 'first');
        await storage.pushToList('queue', 'second');

        await storage.clearList('queue');

        expect(await storage.listLength('queue')).toBe(0);
      });

      it('should return an empty array for an unknown list via getList', async () => {
        expect(await storage.getList('queue')).toEqual([]);
      });

      it('should read the full list without removing items via getList', async () => {
        await storage.pushToList('queue', 'first');
        await storage.pushToList('queue', 'second');

        expect(await storage.getList('queue')).toEqual(['first', 'second']);
        // Non-destructive: length and pop order are unaffected.
        expect(await storage.listLength('queue')).toBe(2);
        expect(await storage.popFromList('queue')).toBe('first');
      });
    });
  });
}

describeStorageProviderContract('InMemoryStorage', () => new InMemoryStorage());
