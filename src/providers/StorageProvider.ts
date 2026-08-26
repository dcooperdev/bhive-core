/**
 * StorageProvider - Agnostic key/value + list storage.
 *
 * Any backend (Redis, MongoDB, PostgreSQL, an in-memory Map, ...) can back
 * a Bee's persistent queue or any other durable state by implementing this
 * interface. Bee/BeeManager depend only on this contract.
 */
export interface StorageProvider {
  /** Identifies the backend, e.g. 'redis', 'mongodb', 'postgresql', 'memory'. */
  readonly name: string;

  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;

  /** Appends a value to the end of the list stored at `key`. */
  pushToList<T = unknown>(key: string, value: T): Promise<void>;
  /** Removes and returns the value at the front of the list, if any. */
  popFromList<T = unknown>(key: string): Promise<T | undefined>;
  listLength(key: string): Promise<number>;
  clearList(key: string): Promise<void>;
}
