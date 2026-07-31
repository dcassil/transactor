export { Transactor, create, init } from './transactor.js';
export type {
  Transaction,
  TransactionOptions,
  TransactorOptions,
  SaveHandler,
  StoreGetter,
  StoreSetter,
  StoreShape,
} from './types.js';

import { create, init, Transactor } from './transactor.js';

/**
 * Default export mirroring the classic CommonJS namespace of
 * `sequence-transactor` v2, for drop-in back-compatibility.
 */
export default { create, init, Transactor };
