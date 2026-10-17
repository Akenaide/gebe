import test from 'node:test';
import assert from 'node:assert';
import { createWriteQueue } from '../src/writeQueue.js';

// Like chrome.storage: callbacks run asynchronously, and an error thrown in one is logged, not passed on.
function fakeStorage() {
  const data = {};
  const later = callback => queueMicrotask(() => {
    try {
      callback();
    } catch {}
  });
  return {
    data,
    get: (key, callback) => later(() => callback({ [key]: data[key] })),
    set: (items, callback) => later(() => {
      Object.assign(data, items);
      callback();
    }),
    remove: (keys, callback) => later(() => {
      for (const key of [keys].flat()) delete data[key];
      callback();
    }),
  };
}

test('createWriteQueue keeps writing after an update throws', async () => {
  /**
   * Given an update that throws queued before a valid one,
   * When the queue runs,
   * Then the valid update is still written.
   */
  const storage = fakeStorage();
  const { enqueueUpdate } = createWriteQueue(storage);
  const crate = { 1: { regular_id: '2040056000' } };
  enqueueUpdate('assistRaids', () => {
    throw new Error('unreadable response');
  });
  const done = enqueueUpdate('crate', () => crate);
  await Promise.race([done, new Promise(resolve => setTimeout(resolve, 100))]);
  assert.deepStrictEqual(storage.data.crate, crate);
});

test('createWriteQueue serializes updates from two pages sharing one storage', async () => {
  /**
   * Given two write queues over one storage, like the panel and a DevTools page,
   * When each adds a friend to the same key at once,
   * Then both friends are kept.
   */
  const storage = fakeStorage();
  const fromDevtools = createWriteQueue(storage).enqueueUpdate;
  const fromPanel = createWriteQueue(storage).enqueueUpdate;
  await Promise.all([
    fromDevtools('friends', friends => ({ ...friends, 1: 'yuzu' })),
    fromPanel('friends', friends => ({ ...friends, 2: 'ゆず' })),
  ]);
  assert.deepStrictEqual(storage.data.friends, { 1: 'yuzu', 2: 'ゆず' });
});

test('createWriteQueue removes a key only after an update already queued on it', async () => {
  /**
   * Given a crate update from DevTools in flight when the panel's Clear removes the crate,
   * When both run,
   * Then the crate is gone, not written back by the update.
   */
  const storage = fakeStorage();
  const { enqueueUpdate } = createWriteQueue(storage);
  const { enqueueRemove } = createWriteQueue(storage);
  await Promise.all([enqueueUpdate('crate', () => ({ 1: { regular_id: '2040056000' } })), enqueueRemove(['crate'])]);
  assert.strictEqual(storage.data.crate, undefined);
});
