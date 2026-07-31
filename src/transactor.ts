import { AsyncQueue } from './async-queue.js';
import { DefaultStore } from './store.js';
import type {
  InternalTransaction,
  SaveHandler,
  StoreGetter,
  StoreSetter,
  StoreShape,
  Transaction,
  TransactionOptions,
  TransactorOptions,
} from './types.js';

/** Transactions grouped by resolved type, ready for batched save handlers. */
interface SortedTransactions<TData> {
  add: TData[];
  update: TData[];
  delete: TData[];
}

/** Module-level default store, used when {@link init} is not given custom handlers. */
let defaultStore = new DefaultStore();
let getter: StoreGetter = defaultStore.get;
let setter: StoreSetter = defaultStore.set;

/**
 * Configure the backing storage. Call with no arguments (or `undefined`) to use
 * a fresh in-memory store. Provide `get`/`set` to inject custom storage.
 *
 * @param dataGet - Custom store getter, or `undefined` for the default.
 * @param dataSet - Custom store setter, or `undefined` for the default.
 */
export function init(dataGet?: StoreGetter, dataSet?: StoreSetter): void {
  if (dataGet === undefined || dataSet === undefined) {
    defaultStore = new DefaultStore();
    getter = defaultStore.get;
    setter = defaultStore.set;
  } else {
    getter = dataGet;
    setter = dataSet;
  }
}

/**
 * Create a new {@link Transactor} instance. Ensures storage is initialised.
 *
 * @param options - Optional caller-defined options attached to the instance.
 */
export function create<TData = unknown, TId = unknown>(
  options?: TransactorOptions,
): Transactor<TData, TId> {
  return new Transactor<TData, TId>(options);
}

function throwIfNoHandler<TData>(
  type: string,
  handler: SaveHandler<TData> | undefined,
): asserts handler is SaveHandler<TData> {
  if (typeof handler !== 'function') {
    throw new Error(
      `transaction was created with option: ${type}, but no valid function was given to handle this type.`,
    );
  }
}

function nextInstanceKey(store: Record<string, unknown>): number {
  const keys = Object.keys(store).map(Number);
  return keys.length > 0 ? Math.max(...keys) + 1 : 0;
}

/** Normalises raw options, applying the update/save defaults. */
function resolveOptions(options: TransactionOptions): TransactionOptions {
  const resolved: TransactionOptions = { ...options };
  if (!(resolved.add ?? resolved.update ?? resolved.delete)) {
    resolved.update = true;
  }
  resolved.save = resolved.save !== false;
  return resolved;
}

/**
 * Tracks an ordered series of client-side transactions against sets of data,
 * with undo/redo, edge dedup, superimpose, and batched or per-item saves.
 *
 * Each instance is isolated in the backing store under a unique key. All reads
 * return copies; the caller's arrays and objects are never mutated.
 *
 * @typeParam TData - The shape of transaction payloads.
 * @typeParam TId - The type of the grouping id passed to {@link Transactor.add}.
 */
export class Transactor<TData = unknown, TId = unknown> {
  /** The unique store key for this instance. */
  readonly key: number;
  /** Caller-defined options supplied at construction. */
  readonly options: TransactorOptions | undefined;

  private revertedTransactions: InternalTransaction<TData, TId>[] = [];
  private readonly queue = new AsyncQueue();

  constructor(options?: TransactorOptions) {
    const store = getter();
    this.key = nextInstanceKey(store);
    this.options = options;
    store[String(this.key)] = [];
    setter(store);
  }

  /**
   * Add a transaction. Clears the redo stack.
   *
   * @param id - Grouping id for the logical record.
   * @param data - The transaction payload.
   * @param options - Optional flags; see {@link TransactionOptions}.
   */
  add(id: TId, data: TData, options: TransactionOptions = {}): void {
    this.addInternal(id, data, options);
    this.revertedTransactions = [];
  }

  /**
   * Add a transaction asynchronously, preserving submission order across
   * concurrent calls. Clears the redo stack. Resolves once applied.
   */
  asyncAdd(id: TId, data: TData, options: TransactionOptions = {}): Promise<void> {
    return this.queue.run(() => {
      this.addInternal(id, data, options);
      this.revertedTransactions = [];
    }, undefined);
  }

  /** Undo up to and including the most recent saveable transaction. */
  back(): void {
    const transactions = this.getInternal();
    const hasSaveable = transactions.some((t) => t.options.save);
    const reverted: InternalTransaction<TData, TId>[] = [];

    let looking = hasSaveable;
    while (looking) {
      const popped = transactions.pop();
      if (popped === undefined) {
        break;
      }
      if (popped.options.save) {
        looking = false;
      }
      reverted.unshift(popped);
    }

    this.revertedTransactions = this.revertedTransactions.concat(reverted);
    this.setInternal(transactions);
  }

  /** Redo up to and including the most recent undone saveable transaction. */
  forward(): void {
    const transactions = this.getInternal();
    const hasSaveable = this.revertedTransactions.some((t) => t.options.save);
    const restored: InternalTransaction<TData, TId>[] = [];

    let looking = hasSaveable;
    while (looking) {
      const popped = this.revertedTransactions.pop();
      if (popped === undefined) {
        break;
      }
      if (popped.options.save) {
        looking = false;
      }
      restored.unshift(popped);
    }

    this.setInternal(transactions.concat(restored));
  }

  /** Remove all transactions for this instance and clear the redo stack. */
  clear(): void {
    this.setInternal([]);
    this.revertedTransactions = [];
  }

  /** Remove this instance's key and data from the backing store. */
  destroy(): void {
    const store = getter();
    const key = String(this.key);
    const next: StoreShape = {};
    for (const existingKey of Object.keys(store)) {
      if (existingKey !== key) {
        next[existingKey] = store[existingKey] ?? [];
      }
    }
    setter(next);
  }

  /** Get all transactions for this instance in insertion order. */
  get(): Transaction<TData, TId>[] {
    return this.getInternal().map(toPublic);
  }

  /** Get the latest transaction per unique id (edge dedup). */
  getLatestEdge(): Transaction<TData, TId>[] {
    return this.getLatest().map(toPublic);
  }

  /**
   * Apply the latest-edge transactions onto a copy of `clientData`.
   * Inserts absent non-delete records, removes deletes, replaces otherwise.
   * The input is never mutated.
   *
   * @param clientData - Records shaped as `{ id, data }`.
   */
  superimpose(clientData: { id: TId; data: TData }[]): { id: TId; data: TData }[] {
    const result = clientData.map((entry) => ({ id: entry.id, data: entry.data }));

    for (const transaction of this.getLatest()) {
      const index = result.findIndex((entry) => entry.id === transaction.id);
      const isDelete = transaction.options.delete === true;

      if (index === -1) {
        if (!isDelete) {
          result.push({ id: transaction.id, data: transaction.data });
        }
        continue;
      }

      if (isDelete) {
        result.splice(index, 1);
      } else {
        result[index] = { id: transaction.id, data: transaction.data };
      }
    }

    return result;
  }

  /** Invoke the matching handler once per saveable transaction (ordered). */
  saveEach(
    put?: SaveHandler<TData>,
    post?: SaveHandler<TData>,
    del?: SaveHandler<TData>,
  ): Promise<unknown[]> {
    return this.saveEachInternal(this.getInternal(), put, post, del);
  }

  /** Like {@link saveEach} but over the latest-edge transactions. */
  saveEachEdge(
    put?: SaveHandler<TData>,
    post?: SaveHandler<TData>,
    del?: SaveHandler<TData>,
  ): Promise<unknown[]> {
    return this.saveEachInternal(this.getLatest(), put, post, del);
  }

  /**
   * Batch-save: sort saveable transactions into add/update/delete arrays and
   * invoke each handler at most once with its non-empty array.
   */
  save(
    put?: SaveHandler<TData[]>,
    post?: SaveHandler<TData[]>,
    del?: SaveHandler<TData[]>,
  ): Promise<unknown[]> {
    return this.saveBatch(sortByType(this.getInternal()), put, post, del);
  }

  /** Like {@link save} but over the latest-edge transactions. */
  saveLatestEdge(
    put?: SaveHandler<TData[]>,
    post?: SaveHandler<TData[]>,
    del?: SaveHandler<TData[]>,
  ): Promise<unknown[]> {
    return this.saveBatch(sortByType(this.getLatest()), put, post, del);
  }

  private addInternal(id: TId, data: TData, options: TransactionOptions): void {
    const transactions = this.getInternal();
    transactions.push({
      id,
      data,
      options: resolveOptions(options),
      _id: claimId(transactions, id),
    });
    this.setInternal(transactions);
  }

  private getInternal(): InternalTransaction<TData, TId>[] {
    const list = getter()[String(this.key)];
    return (list ?? []) as InternalTransaction<TData, TId>[];
  }

  private getLatest(): InternalTransaction<TData, TId>[] {
    const result: InternalTransaction<TData, TId>[] = [];

    for (const transaction of this.getInternal()) {
      const index = result.findIndex((d) => d.id === transaction.id);
      if (index === -1) {
        result.push(transaction);
        continue;
      }

      const existing = result[index];
      if (existing?.options.add === true) {
        if (transaction.options.delete === true) {
          // add-then-delete cancels out.
          result.splice(index, 1);
        } else {
          // add-then-update stays an "add".
          result[index] = {
            ...transaction,
            options: { save: transaction.options.save === true, add: true },
          };
        }
      } else {
        result[index] = transaction;
      }
    }

    return result;
  }

  private setInternal(data: InternalTransaction<TData, TId>[]): void {
    const store = getter();
    store[String(this.key)] = data;
    setter(store);
  }

  private saveEachInternal(
    transactions: InternalTransaction<TData, TId>[],
    put: SaveHandler<TData> | undefined,
    post: SaveHandler<TData> | undefined,
    del: SaveHandler<TData> | undefined,
  ): Promise<unknown[]> {
    const promises: Promise<unknown>[] = [];

    for (const transaction of transactions) {
      if (transaction.options.save !== true) {
        continue;
      }
      if (transaction.options.add === true) {
        throwIfNoHandler('add', post);
        promises.push(this.queue.run(post, transaction.data));
      } else if (transaction.options.delete === true) {
        throwIfNoHandler('delete', del);
        promises.push(this.queue.run(del, transaction.data));
      } else {
        throwIfNoHandler('update', put);
        promises.push(this.queue.run(put, transaction.data));
      }
    }

    return Promise.all(promises);
  }

  private saveBatch(
    sorted: SortedTransactions<TData>,
    put: SaveHandler<TData[]> | undefined,
    post: SaveHandler<TData[]> | undefined,
    del: SaveHandler<TData[]> | undefined,
  ): Promise<unknown[]> {
    const promises: unknown[] = [];

    if (sorted.add.length > 0) {
      throwIfNoHandler('add', post);
      promises.push(post(sorted.add));
    }
    if (sorted.update.length > 0) {
      throwIfNoHandler('update', put);
      promises.push(put(sorted.update));
    }
    if (sorted.delete.length > 0) {
      throwIfNoHandler('delete', del);
      promises.push(del(sorted.delete));
    }

    return Promise.all(promises);
  }
}

/**
 * Assigns the internal ordering id. Preserves legacy behaviour: the first
 * transaction adopts the caller-supplied numeric id (falling back to 0 for
 * non-numeric ids); subsequent transactions use `max(existing) + 1`.
 */
function claimId<TData, TId>(transactions: InternalTransaction<TData, TId>[], id: TId): number {
  if (transactions.length === 0) {
    return typeof id === 'number' ? id : 0;
  }
  return Math.max(...transactions.map((t) => t._id)) + 1;
}

function toPublic<TData, TId>(t: InternalTransaction<TData, TId>): Transaction<TData, TId> {
  return { id: t.id, data: t.data, options: t.options };
}

function sortByType<TData, TId>(
  transactions: InternalTransaction<TData, TId>[],
): SortedTransactions<TData> {
  const sorted: SortedTransactions<TData> = { add: [], update: [], delete: [] };

  for (const transaction of transactions) {
    if (transaction.options.save !== true) {
      continue;
    }
    if (transaction.options.add === true) {
      sorted.add.push(transaction.data);
    } else if (transaction.options.delete === true) {
      sorted.delete.push(transaction.data);
    } else {
      sorted.update.push(transaction.data);
    }
  }

  return sorted;
}
