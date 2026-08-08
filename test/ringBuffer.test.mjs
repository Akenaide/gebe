import test from 'node:test';
import assert from 'node:assert';
import { mergeEntries } from '../src/ringBuffer.js';

test('mergeEntries concatenates existing and imported entries, deduped by id', () => {
  /**
   * Given an existing entry with id 'a' and an imported list containing that same id 'a'
   * plus a new id 'b',
   * When mergeEntries is called,
   * Then the result has exactly one 'a' (the existing one wins) and one 'b', in that order.
   */
  const existing = [{ id: 'a', url: 'existing' }];
  const imported = [{ id: 'a', url: 'imported-duplicate' }, { id: 'b', url: 'new' }];
  assert.deepStrictEqual(mergeEntries(existing, imported), [
    { id: 'a', url: 'existing' },
    { id: 'b', url: 'new' },
  ]);
});
