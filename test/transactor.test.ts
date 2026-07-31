import { beforeEach, describe, expect, it, vi } from 'vitest';
import transactor, { create, init, Transactor, type StoreShape } from '../src/index.js';

interface Item {
  id: number;
  value?: string;
  isNew?: boolean;
  val?: string;
}

const mockItem: Item = { id: 1, value: 'test' };

beforeEach(() => {
  init(); // reset to a fresh default store between tests
});

describe('init & create', () => {
  it('create returns a Transactor instance', () => {
    expect(create()).toBeInstanceOf(Transactor);
  });

  it('default export exposes create/init/Transactor', () => {
    expect(transactor.create).toBe(create);
    expect(transactor.init).toBe(init);
    expect(transactor.Transactor).toBe(Transactor);
  });

  it('uses default getter and setter when init called with no args', () => {
    const t = create<Item>();
    t.add(1, mockItem);
    expect(t.key).toBe(0);
    expect(t.get()).toHaveLength(1);
  });

  it('uses a provided getter and setter', () => {
    let store: StoreShape = {};
    const getStub = vi.fn(() => store);
    const setStub = vi.fn((v: StoreShape) => {
      store = v;
    });

    init(getStub, setStub);
    create();

    expect(getStub).toHaveBeenCalled();
    expect(setStub).toHaveBeenCalled();
  });

  it('sets instance options', () => {
    const options = { test: true };
    expect(create(options).options).toEqual(options);
  });

  it('gives each instance a unique key', () => {
    expect(create().key).not.toEqual(create().key);
  });
});

describe('add', () => {
  let t: Transactor<Item>;
  beforeEach(() => {
    t = create<Item>();
  });

  it('creates a unique _id for each add and leaves id unchanged', () => {
    t.add(1, mockItem);
    t.add(1, { id: 1, isNew: true });
    const all = t.get();
    expect(all[0]?.id).toBe(1);
    expect(all[1]?.id).toBe(1);
  });

  it('defaults save to true and update when no type given', () => {
    t.add(1, mockItem);
    expect(t.get()[0]?.options).toEqual({ save: true, update: true });
  });

  it('respects explicit save=false and preserves custom flags', () => {
    t.add(1, mockItem, { save: false, add: true });
    expect(t.get()[0]?.options).toEqual({ save: false, add: true });
  });

  it('does not mutate the caller-provided options object', () => {
    const opts = {};
    t.add(1, mockItem, opts);
    expect(opts).toEqual({});
  });
});

describe('get / getLatestEdge', () => {
  let t: Transactor<Item>;
  beforeEach(() => {
    t = create<Item>();
  });

  it('returns all transactions with resolved options', () => {
    t.add(1, mockItem);
    t.add(2, mockItem, { add: true });
    t.add(3, mockItem, { delete: true });
    t.add(4, mockItem, { save: false });
    t.add(5, mockItem, { update: true });

    const all = t.get();
    expect(all[0]).toEqual({ id: 1, data: mockItem, options: { save: true, update: true } });
    expect(all[1]).toEqual({ id: 2, data: mockItem, options: { save: true, add: true } });
    expect(all[2]).toEqual({ id: 3, data: mockItem, options: { save: true, delete: true } });
    expect(all[3]).toEqual({ id: 4, data: mockItem, options: { save: false, update: true } });
    expect(all[4]).toEqual({ id: 5, data: mockItem, options: { save: true, update: true } });
  });

  it('edge dedup keeps the latest per id', () => {
    const change = { id: 3, value: 'change' };
    t.add(1, mockItem);
    t.add(1, change);
    const edge = t.getLatestEdge();
    expect(edge[0]?.data).toEqual(change);
    expect(edge[1]).toBeUndefined();
  });

  it('mutating the returned array does not affect stored state', () => {
    t.add(1, mockItem);
    const all = t.get();
    all.pop();
    expect(t.get()).toHaveLength(1);
  });
});

describe('back / forward', () => {
  let t: Transactor<Item>;
  beforeEach(() => {
    t = create<Item>();
  });

  it('does not revert when there is no saveable transaction', () => {
    t.add(1, mockItem, { save: false });
    t.add(1, { id: 1, value: 'test change' }, { save: false });
    t.back();
    expect(t.get()).toHaveLength(2);
  });

  it('reverts to the previous saveable transaction', () => {
    t.add(1, mockItem);
    t.add(1, { id: 1, value: 'test change' });
    t.back();
    const all = t.get();
    expect(all).toHaveLength(1);
    expect(all[0]?.data.value).toBe('test');
  });

  it('forward redoes the last reversion', () => {
    t.add(1, mockItem);
    t.add(1, { id: 1, value: 'test change' });
    t.back();
    t.forward();
    const all = t.get();
    expect(all[1]?.data.value).toBe('test change');
  });

  it('forward does nothing when nothing was reverted', () => {
    t.add(1, mockItem, { save: false });
    t.add(1, { id: 1, value: 'test change' });
    t.add(1, { id: 1, value: 'test change 2' }, { save: false });
    t.back();
    expect(t.get()).toHaveLength(1);
    t.forward();
    expect(t.get()).toHaveLength(3);
  });

  it('add clears the redo stack', () => {
    t.add(1, mockItem);
    t.add(1, { id: 1, value: 'change' });
    t.back();
    t.add(1, { id: 1, value: 'new' });
    t.forward(); // nothing to redo
    const all = t.get();
    expect(all).toHaveLength(2);
    expect(all[1]?.data.value).toBe('new');
  });
});

describe('clear / destroy / isolation', () => {
  it('clear empties this instance only', () => {
    const a = create<Item>();
    const b = create<Item>();
    a.add(1, mockItem);
    b.add(1, mockItem);
    a.clear();
    expect(a.get()).toHaveLength(0);
    expect(b.get()).toHaveLength(1);
  });

  it('destroy removes this instance from the store', () => {
    const a = create<Item>();
    a.add(1, mockItem);
    a.destroy();
    expect(a.get()).toHaveLength(0);
  });

  it('destroy preserves sibling instances', () => {
    const a = create<Item>();
    const b = create<Item>();
    a.add(1, mockItem);
    b.add(1, mockItem);
    a.destroy();
    expect(a.get()).toHaveLength(0);
    expect(b.get()).toHaveLength(1);
  });

  it('instances do not corrupt each other through the shared store', () => {
    const a = create<Item>();
    const b = create<Item>();
    a.add(1, { id: 1, value: 'a' });
    b.add(1, { id: 1, value: 'b' });
    expect(a.get()[0]?.data.value).toBe('a');
    expect(b.get()[0]?.data.value).toBe('b');
  });
});

describe('asyncAdd', () => {
  let t: Transactor<Item>;
  beforeEach(() => {
    t = create<Item>();
  });

  it('adds a transaction', async () => {
    await t.asyncAdd(1, mockItem);
    expect(t.get()).toHaveLength(1);
  });

  it('preserves order across concurrent calls', async () => {
    const p1 = t.asyncAdd(1, { id: 1, value: 'first' });
    const p2 = t.asyncAdd(1, { id: 1, value: 'second' });
    await Promise.all([p1, p2]);
    const all = t.get();
    expect(all[0]?.data.value).toBe('first');
    expect(all[1]?.data.value).toBe('second');
  });

  it('clears the redo stack', async () => {
    t.add(1, mockItem);
    t.add(1, { id: 1, value: 'change' });
    t.back();
    await t.asyncAdd(1, { id: 1, value: 'async' });
    t.forward();
    expect(t.get()).toHaveLength(2);
  });
});

describe('saveEach / saveEachEdge', () => {
  let t: Transactor<Item>;
  let work: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    t = create<Item>();
    work = vi.fn(() => Promise.resolve());
  });

  it('calls work for each saveable transaction', async () => {
    t.add(1, mockItem);
    t.add(2, mockItem);
    await t.saveEach(work);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('ignores non-saveable transactions', async () => {
    t.add(1, mockItem, { save: false });
    t.add(2, mockItem);
    await t.saveEach(work);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('routes add/update/delete to their handlers', async () => {
    const add = vi.fn(() => Promise.resolve());
    const update = vi.fn(() => Promise.resolve());
    const del = vi.fn(() => Promise.resolve());
    t.add(1, mockItem, { delete: true });
    t.add(1, mockItem, { add: true });
    t.add(1, mockItem, { update: true });
    await t.saveEach(update, add, del);
    expect(add).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledTimes(1);
  });

  it('runs work serially (ordered)', async () => {
    const start = Date.now();
    t.add(1, mockItem);
    t.add(2, mockItem);
    t.add(3, mockItem);
    await t.saveEach(() => new Promise((r) => setTimeout(r, 10)));
    expect(Date.now() - start).toBeGreaterThanOrEqual(28);
  });

  it('throws a clear error when a needed handler is missing', () => {
    t.add(1, mockItem, { add: true });
    expect(() => t.saveEach()).toThrow(/option: add/);
  });

  it('saveEachEdge collapses add-then-update to a single add call', async () => {
    const add = vi.fn(() => Promise.resolve());
    const update = vi.fn(() => Promise.resolve());
    t.add(1, mockItem, { add: true });
    t.add(1, mockItem, { update: true });
    await t.saveEachEdge(update, add);
    expect(add).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(0);
  });

  it('saveEachEdge skips add-then-delete entirely', async () => {
    const add = vi.fn(() => Promise.resolve());
    const del = vi.fn(() => Promise.resolve());
    t.add(1, mockItem, { add: true });
    t.add(1, mockItem, { delete: true });
    await t.saveEachEdge(undefined, add, del);
    expect(add).toHaveBeenCalledTimes(0);
    expect(del).toHaveBeenCalledTimes(0);
  });
});

describe('save / saveLatestEdge', () => {
  let t: Transactor<Item>;
  let work: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    t = create<Item>();
    work = vi.fn(() => Promise.resolve());
  });

  it('calls update once with an array', async () => {
    t.add(1, mockItem);
    t.add(2, mockItem);
    await t.save(work);
    expect(work).toHaveBeenCalledTimes(1);
    expect(work).toHaveBeenCalledWith([mockItem, mockItem]);
  });

  it('calls add/update/delete once each', async () => {
    t.add(1, mockItem, { add: true });
    t.add(2, mockItem, { update: true });
    t.add(3, mockItem, { delete: true });
    await t.save(work, work, work);
    expect(work).toHaveBeenCalledTimes(3);
  });

  it('does not call work with an empty array', async () => {
    await t.save(work);
    expect(work).toHaveBeenCalledTimes(0);
  });

  it('excludes non-saveable transactions from the batch', async () => {
    t.add(1, mockItem, { save: false });
    await t.save(work);
    expect(work).toHaveBeenCalledTimes(0);
  });

  it('throws when a batch handler is missing for non-empty data', () => {
    t.add(1, mockItem, { add: true });
    expect(() => t.save(work)).toThrow(/option: add/);
  });

  it('saveLatestEdge defaults to update and uses latest per id', async () => {
    t.add(1, { id: 1, value: 'test' });
    t.add(1, { id: 1, value: 'test 1' });
    t.add(2, { id: 2, value: 'test 2' });
    await t.saveLatestEdge(work);
    expect(work).toHaveBeenCalledWith([
      { id: 1, value: 'test 1' },
      { id: 2, value: 'test 2' },
    ]);
  });

  it('saveLatestEdge treats add-then-update as a single add', async () => {
    const add = vi.fn(() => Promise.resolve());
    t.add(1, mockItem, { add: true });
    t.add(1, mockItem);
    await t.saveLatestEdge(undefined, add);
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('saveLatestEdge skips add-then-delete', async () => {
    t.add(1, mockItem, { add: true });
    t.add(1, mockItem, { delete: true });
    await t.saveLatestEdge(work, work, work);
    expect(work).toHaveBeenCalledTimes(0);
  });
});

describe('superimpose', () => {
  let t: Transactor<Item>;
  beforeEach(() => {
    t = create<Item>();
  });

  const wrap = (data: Item[]) => data.map((d) => ({ id: d.id, data: d }));

  it('applies the latest transaction on top of client data', () => {
    t.add(1, { id: 1, val: 'test update' });
    t.add(1, { id: 1, val: 'test update 2' });
    const result = t.superimpose(wrap([{ id: 1, val: 'test' }]));
    expect(result).toHaveLength(1);
    expect(result[0]?.data.val).toBe('test update 2');
  });

  it('removes items marked for delete', () => {
    t.add(1, { id: 1, val: 'x' }, { delete: true });
    const result = t.superimpose(
      wrap([
        { id: 1, val: 'test' },
        { id: 2, val: 'test2' },
      ]),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.data.val).toBe('test2');
  });

  it('inserts absent non-delete records', () => {
    t.add(1, { id: 1, val: 'inserted' });
    const result = t.superimpose(wrap([{ id: 2, val: 'test' }]));
    expect(result).toHaveLength(2);
  });

  it('BUGFIX: a delete for an absent id does not corrupt data', () => {
    // Legacy code ran clientData.splice([-1], 1) here, dropping the last item.
    t.add(99, { id: 99 }, { delete: true });
    const result = t.superimpose(
      wrap([
        { id: 1, val: 'keep-a' },
        { id: 2, val: 'keep-b' },
      ]),
    );
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.data.val)).toEqual(['keep-a', 'keep-b']);
  });

  it('never mutates the input array or its entries', () => {
    const input = wrap([{ id: 1, val: 'test' }]);
    t.add(1, { id: 1, val: 'update' });
    t.superimpose(input);
    expect(input[0]?.data.val).toBe('test');
  });
});
