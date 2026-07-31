import type { StoreGetter, StoreSetter, StoreShape } from './types.js';

/**
 * Default in-memory store. Instance isolation is provided by keying each
 * {@link Transactor} instance under a unique key; deep copies on read/write
 * prevent callers from mutating stored arrays and prevent cross-instance
 * corruption of the shared module store.
 */
export class DefaultStore {
  private store: StoreShape = {};

  /** Returns a deep copy of the store so callers cannot mutate stored state. */
  readonly get: StoreGetter = () => cloneStore(this.store);

  /** Replaces the store with a deep copy of the provided value. */
  readonly set: StoreSetter = (value) => {
    this.store = cloneStore(value);
  };
}

/**
 * Deep-clones a store shape. Instance arrays and their transaction records are
 * copied so that no stored array reference escapes to callers and no caller
 * array reference is retained by the store.
 */
export function cloneStore(store: StoreShape): StoreShape {
  const next: StoreShape = {};
  for (const key of Object.keys(store)) {
    const list = store[key];
    if (list !== undefined) {
      next[key] = list.map((transaction) => ({ ...transaction }));
    }
  }
  return next;
}
