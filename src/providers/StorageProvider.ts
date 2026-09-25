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

  /**
   * Atomically sets `key` to `value` only if it does not already exist,
   * with the entry expiring after `ttlMs`. Returns true if this call set
   * it, false if it already existed (meaning: someone else got there
   * first - used for distributed replay/deduplication where a check
   * followed by a separate set would race across processes).
   *
   * Must be a single atomic operation in the backend: e.g.
   * `SET key value NX PX ttlMs` in Redis, or `INSERT ... ON CONFLICT DO
   * NOTHING` (plus an expiry column checked on read) in SQL. An expired
   * entry counts as absent.
   */
  setIfNotExists(key: string, value: string, ttlMs: number): Promise<boolean>;

  /** Appends a value to the end of the list stored at `key`. */
  pushToList<T = unknown>(key: string, value: T): Promise<void>;
  /** Removes and returns the value at the front of the list, if any. */
  popFromList<T = unknown>(key: string): Promise<T | undefined>;
  listLength(key: string): Promise<number>;
  clearList(key: string): Promise<void>;
  /** Returns every item currently in the list, oldest first, without removing them. */
  getList<T = unknown>(key: string): Promise<T[]>;
}
