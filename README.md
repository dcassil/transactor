# sequence-transactor

![CI](https://github.com/dcassil/transactor/actions/workflows/ci.yml/badge.svg)
![npm](https://img.shields.io/npm/v/sequence-transactor.svg)
![license](https://img.shields.io/badge/license-BSD--3--Clause-blue.svg)
![types](https://img.shields.io/badge/types-TypeScript-blue.svg)

Track client-side transactional changes to data — with undo/redo, edge dedup,
superimpose, and batched or per-item saves. Fully typed, immutable, zero runtime
dependencies.

## Install

```bash
npm i sequence-transactor
```

## What & why

`sequence-transactor` records an ordered sequence of local changes ("transactions")
against sets of data, so you can operate on them individually or as a whole. Build
up a batch of edits in the UI, undo/redo through them, superimpose them onto data
you already have, then flush them to your backend in one or many calls. Each
instance is isolated, so you can track several independent sets of changes at once.

It was purpose-built for the case where a server mutates data on save and the
client needs to mimic that state locally before saving — hence the distinction
between _saveable_ and _non-saveable_ transactions.

## Quick start

```ts
import { create } from 'sequence-transactor';

interface User {
  id: number;
  name: string;
}

const t = create<User>();

t.add(1, { id: 1, name: 'Ada' }); // update (the default)
t.add(1, { id: 1, name: 'Ada L.' }); // another change to the same record
t.add(2, { id: 2, name: 'Alan' }, { add: true });

// All transactions, in order:
t.get();

// Latest transaction per id (edge dedup):
t.getLatestEdge();

// Undo up to and including the last saveable transaction:
t.back();
// Redo it:
t.forward();

// Flush to a backend — one call per operation type:
await t.save(
  (updates) => api.put(updates), // put   — updates
  (creates) => api.post(creates), // post  — adds
  (deletes) => api.del(deletes), // del   — deletes
);
```

### Grouping by id

The first argument to `add(id, data)` groups transactions. These three are seen as
**one** record with three transactions:

```ts
t.add(1, { id: 1, value: 'a' });
t.add(1, { id: 2, value: 'b' });
t.add(1, { id: 3, value: 'c' });
```

while these are seen as **three** records with one transaction each:

```ts
t.add(1, { id: 1, value: 'a' });
t.add(2, { id: 1, value: 'b' });
t.add(3, { id: 1, value: 'c' });
```

### superimpose

Apply the latest-edge transactions onto a copy of data you already hold. The input
is never mutated.

```ts
const clientData = [{ id: 1, val: 'test' }];
t.add(1, { id: 1, val: 'updated' });

t.superimpose(clientData.map((cd) => ({ id: cd.id, data: cd })));
// => [{ id: 1, data: { id: 1, val: 'updated' } }]
```

A transaction added with `{ delete: true }` removes the matching record from the
result.

## API reference

| Method                              | Description                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| `create(options?)`                  | Factory returning a `Transactor` instance.                                                       |
| `new Transactor(options?)`          | Same as `create`; the class is exported too.                                                     |
| `init(get?, set?)`                  | Inject custom storage `get`/`set`. No args resets to a fresh in-memory store.                    |
| `add(id, data, options?)`           | Add a transaction. Clears the redo stack.                                                        |
| `asyncAdd(id, data, options?)`      | Add asynchronously, preserving submission order across concurrent calls. Returns a `Promise`.    |
| `get()`                             | All transactions `{ id, data, options }` in order.                                               |
| `getLatestEdge()`                   | Latest transaction per unique id (edge dedup).                                                   |
| `back()`                            | Undo up to and including the last saveable transaction.                                          |
| `forward()`                         | Redo up to and including the last undone saveable transaction.                                   |
| `superimpose(clientData)`           | Apply latest-edge transactions onto a copy of `clientData`. Never mutates the input.             |
| `save(put?, post?, del?)`           | Batch: sort saveable transactions into add/update/delete arrays; call each handler once, if any. |
| `saveLatestEdge(put?, post?, del?)` | As `save`, over the latest-edge transactions.                                                    |
| `saveEach(put?, post?, del?)`       | Call the matching handler once per saveable transaction, in order.                               |
| `saveEachEdge(put?, post?, del?)`   | As `saveEach`, over the latest-edge transactions.                                                |
| `clear()`                           | Remove all transactions for this instance and clear the redo stack.                              |
| `destroy()`                         | Remove this instance's data from the backing store.                                              |

### Options

`add(id, data, options)` accepts:

| Option   | Default                        | Meaning                                                                     |
| -------- | ------------------------------ | --------------------------------------------------------------------------- |
| `add`    | —                              | Treat as a create; routed to the `post` handler on save.                    |
| `update` | `true` (when no type is given) | Treat as an update; routed to the `put` handler.                            |
| `delete` | —                              | Treat as a delete; routed to `del`, and drives `superimpose`.               |
| `save`   | `true` (unless set to `false`) | Whether the transaction is sent to handlers and forms undo/redo boundaries. |

All save handlers may return a promise; every save method returns a `Promise` that
resolves once all handler promises resolve. If a transaction needs a handler that
was not supplied, a clear error is thrown.

## Undo/redo & edge semantics

- `back()` / `forward()` move up to **and including** the last _saveable_ transaction,
  so a saveable change plus any trailing non-saveable changes are undone/redone as a
  unit.
- Adding a new transaction clears the redo stack.
- Edge dedup (`getLatestEdge`, `saveLatestEdge`, `saveEachEdge`, `superimpose`) keeps
  the latest transaction per id, with two nuances: **add-then-update** stays an
  `add`, and **add-then-delete** cancels out entirely.

## Migration: v2 → v3

v3 is a first-class TypeScript rewrite. The public API is compatible with v2 — the
same `create`/`init`/`Transactor`, the same methods and option semantics — now with
generics over your data type, bundled type declarations, and ESM output.

Behavioural fix in v3: `superimpose` no longer corrupts data when a `delete`
transaction targets an id that is not present in the client data (v2 removed the
wrong element). Internals are now immutable — stored arrays and caller-provided
arrays/objects are never mutated.

## License

BSD-3-Clause © 2018–2026 Daniel Cassil
