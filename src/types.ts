/**
 * Options describing how a transaction should be treated.
 *
 * Exactly one of {@link TransactionOptions.add | add},
 * {@link TransactionOptions.update | update}, or
 * {@link TransactionOptions.delete | delete} is normally set. When none is
 * provided, `add` defaults to treating the transaction as an update.
 */
export interface TransactionOptions {
  /** Treat this transaction as a create/insert. */
  add?: boolean;
  /** Treat this transaction as an update (the default when none set). */
  update?: boolean;
  /** Treat this transaction as a delete. Also drives {@link Transactor.superimpose}. */
  delete?: boolean;
  /**
   * Whether the transaction is sent to save handlers and participates in
   * undo/redo boundaries. Defaults to `true` unless explicitly set to `false`.
   */
  save?: boolean;
  /** Additional caller-defined flags are preserved verbatim. */
  [key: string]: boolean | undefined;
}

/**
 * A public, read-only view of a stored transaction.
 *
 * @typeParam TData - The shape of the data carried by the transaction.
 * @typeParam TId - The type of the caller-supplied id used to group transactions.
 */
export interface Transaction<TData, TId = unknown> {
  /** Caller-supplied id used to group transactions of the same logical record. */
  readonly id: TId;
  /** The transaction payload. */
  readonly data: TData;
  /** The resolved options for this transaction. */
  readonly options: TransactionOptions;
}

/**
 * An internal transaction record. Adds a monotonic per-instance `_id` used to
 * preserve insertion order and disambiguate transactions sharing the same `id`.
 *
 * @internal
 */
export interface InternalTransaction<TData, TId = unknown> extends Transaction<TData, TId> {
  /** Monotonic unique id assigned per instance in insertion order. */
  readonly _id: number;
}

/** A handler invoked with data to persist. May return a promise. */
export type SaveHandler<TData> = (data: TData) => unknown;

/** Getter for the backing store: returns the full keyed store object. */
export type StoreGetter = () => StoreShape;

/** Setter for the backing store: receives the full keyed store object. */
export type StoreSetter = (value: StoreShape) => void;

/**
 * The backing store shape: a map of instance key to that instance's ordered
 * list of internal transactions.
 *
 * @internal
 */
export type StoreShape = Record<string, InternalTransaction<unknown>[]>;

/** Options accepted by {@link create} / the {@link Transactor} constructor. */
export type TransactorOptions = Record<string, unknown>;
