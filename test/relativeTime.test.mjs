import test from 'node:test';
import assert from 'node:assert';
import { relativeTime } from '../src/relativeTime.js';

test('relativeTime says how long ago, in seconds, minutes then hours', () => {
  /**
   * Given a last action at 1000 seconds,
   * When relativeTime is called at 1005, 1125 and 8200,
   * Then it returns "5s ago", "2m ago" and "2h ago".
   */
  const results = [1005, 1125, 8200].map(now => relativeTime(1000, now));
  assert.deepStrictEqual(results, ['5s ago', '2m ago', '2h ago']);
});
