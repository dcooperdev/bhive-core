import { StorageProvider } from '../providers/StorageProvider';

interface Entry<T> {
  value: T;
  expiresAt?: number;
}

/**
 * InMemoryStorage - StorageProvider backed by a plain Map.
 *
 * Useful for development, tests, and single-instance deployments. State
 * lives only in this process and is lost on restart.
 */
export class InMemoryStorage implements StorageProvider {
  readonly name = 'memory';

  private store = new Map<string, Entry<unknown>>();
  private lists = new Map<string, unknown[]>();

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const entry = this.store.get(key);

    if (!entry) return undefined;

    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value as T;
  }

  async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlMs !== undefined ? Date.now() + ttlMs : undefined
    });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }

  async pushToList<T = unknown>(key: string, value: T): Promise<void> {
    const list = this.lists.get(key) ?? [];
    list.push(value);
    this.lists.set(key, list);
  }

  async popFromList<T = unknown>(key: string): Promise<T | undefined> {
    const list = this.lists.get(key);
    if (!list || list.length === 0) return undefined;
    return list.shift() as T;
  }

  async listLength(key: string): Promise<number> {
    return this.lists.get(key)?.length ?? 0;
  }

  async clearList(key: string): Promise<void> {
    this.lists.delete(key);
  }

  async getList<T = unknown>(key: string): Promise<T[]> {
    return [...(this.lists.get(key) ?? [])] as T[];
  }
}
