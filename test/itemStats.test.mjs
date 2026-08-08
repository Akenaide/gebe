import test from 'node:test';
import assert from 'node:assert';
import { countCrateDuplicates, countInventoryDuplicates } from '../src/itemStats.js';

test('countCrateDuplicates counts repeated regular_id among entries of the given item_kind_id', () => {
  /**
   * Given a captured entry whose response body list contains two distinct Tetragod summons
   * (regular_id 2040435000, same as the real duplicate seen in present.json, but two different
   * item `id`s since they're two separate physical presents), one Shiva summon, and one weapon
   * (item_kind_id '1') that must be ignored when querying for kind '2',
   * When countCrateDuplicates is called with itemKindId '2',
   * Then Tetragod is reported with count 2 and Shiva with count 1, sorted by count desc, and the
   * weapon does not appear.
   */
  const responseBody = JSON.stringify({
    list: [
      { id: '6891474499', item_kind_id: '2', regular_id: 2040435000, item_name: 'Tetragod' },
      { id: '6903804131', item_kind_id: '2', regular_id: 2040435000, item_name: 'Tetragod' },
      { id: '6919948785', item_kind_id: '2', regular_id: 2040185000, item_name: 'Shiva' },
      { id: '7000000001', item_kind_id: '1', regular_id: 1040000000, item_name: 'Some Weapon' },
    ],
  });
  const result = countCrateDuplicates([{ responseBody }], '2');
  assert.deepStrictEqual(result, [
    { regular_id: 2040435000, item_name: 'Tetragod', count: 2 },
    { regular_id: 2040185000, item_name: 'Shiva', count: 1 },
  ]);
});

test('countCrateDuplicates dedupes by item id so a re-captured item is not counted twice', () => {
  /**
   * Given two separate captures (e.g. the same present-list page fetched twice, such as on
   * a refresh) that both contain the exact same Tetragod item id,
   * When countCrateDuplicates is called across both captures with itemKindId '2',
   * Then Tetragod is reported with count 1, not 2 — the repeat id is deduped, not double-counted.
   */
  const makeBody = () => JSON.stringify({
    list: [{ id: '6891474499', item_kind_id: '2', regular_id: 2040435000, item_name: 'Tetragod' }],
  });
  const result = countCrateDuplicates([{ responseBody: makeBody() }, { responseBody: makeBody() }], '2');
  assert.deepStrictEqual(result, [{ regular_id: 2040435000, item_name: 'Tetragod', count: 1 }]);
});

test('countCrateDuplicates skips entries with no parseable list', () => {
  /**
   * Given a capture whose responseBody is not valid JSON,
   * When countCrateDuplicates is called,
   * Then it returns an empty array instead of throwing.
   */
  const result = countCrateDuplicates([{ responseBody: 'not json' }], '2');
  assert.deepStrictEqual(result, []);
});

test('countInventoryDuplicates splits a 0★ copy and a 1★ copy of the same summon', () => {
  /**
   * Given two owned copies of the same summon (master.id 2040158000): one at 0 uncap stars
   * (param.evolution '0') and one at 1 uncap star (param.evolution '1'),
   * When countInventoryDuplicates is called with urlPattern '/summon/list/',
   * Then zeroStarCount is 1 and nonZeroStars lists the single 1★ copy by its own param.id.
   */
  const responseBody = JSON.stringify({
    list: [
      { param: { id: 1243639174, evolution: '0' }, master: { id: 2040158000 } },
      { param: { id: 1208254746, evolution: '1' }, master: { id: 2040158000 } },
    ],
  });
  const entry = { url: 'https://game.granbluefantasy.jp/summon/list/2?...', responseBody };
  const result = countInventoryDuplicates([entry], '/summon/list/');
  assert.deepStrictEqual(result, [
    { master_id: 2040158000, zeroStarCount: 1, nonZeroStars: [{ param_id: 1208254746, evolution: 1 }] },
  ]);
});

test('countInventoryDuplicates lists every non-0★ copy individually, matching the real 4x duplicate seen in inventory-summon.json', () => {
  /**
   * Given a captured /summon/list/ response whose list contains four param/master items sharing
   * master.id 2040158000 (the real duplicate from inventory-summon.json, param.ids 1243639174,
   * 1208254746, 1091463657, 1067755759, all at evolution '3' in the real data),
   * When countInventoryDuplicates is called with urlPattern '/summon/list/',
   * Then zeroStarCount is 0 and nonZeroStars lists all four copies individually at evolution 3,
   * not a single folded number.
   */
  const responseBody = JSON.stringify({
    list: [
      { param: { id: 1243639174, evolution: '3' }, master: { id: 2040158000 } },
      { param: { id: 1208254746, evolution: '3' }, master: { id: 2040158000 } },
      { param: { id: 1091463657, evolution: '3' }, master: { id: 2040158000 } },
      { param: { id: 1067755759, evolution: '3' }, master: { id: 2040158000 } },
    ],
  });
  const entry = { url: 'https://game.granbluefantasy.jp/summon/list/2?...', responseBody };
  const result = countInventoryDuplicates([entry], '/summon/list/');
  assert.deepStrictEqual(result, [
    {
      master_id: 2040158000,
      zeroStarCount: 0,
      nonZeroStars: [
        { param_id: 1243639174, evolution: 3 },
        { param_id: 1208254746, evolution: 3 },
        { param_id: 1091463657, evolution: 3 },
        { param_id: 1067755759, evolution: 3 },
      ],
    },
  ]);
});

test('countInventoryDuplicates omits a master.id with only one owned copy', () => {
  /**
   * Given a single owned copy of a summon (no duplicate),
   * When countInventoryDuplicates is called,
   * Then the result is empty — one copy isn't a duplicate.
   */
  const responseBody = JSON.stringify({
    list: [{ param: { id: 1, evolution: '0' }, master: { id: 2040158000 } }],
  });
  const entry = { url: 'https://game.granbluefantasy.jp/summon/list/2?...', responseBody };
  const result = countInventoryDuplicates([entry], '/summon/list/');
  assert.deepStrictEqual(result, []);
});

test('countInventoryDuplicates ignores captures whose url does not match urlPattern', () => {
  /**
   * Given a capture from an unrelated endpoint (e.g. /present/list/) containing items that would
   * otherwise look like param/master data,
   * When countInventoryDuplicates is called with urlPattern '/summon/list/',
   * Then that capture is ignored entirely and the result is empty.
   */
  const entry = {
    url: 'https://game.granbluefantasy.jp/present/list/2/0/2?...',
    responseBody: JSON.stringify({
      list: [
        { param: { id: 1, evolution: '0' }, master: { id: 2040158000 } },
        { param: { id: 2, evolution: '0' }, master: { id: 2040158000 } },
      ],
    }),
  };
  const result = countInventoryDuplicates([entry], '/summon/list/');
  assert.deepStrictEqual(result, []);
});

test('countInventoryDuplicates dedupes by param.id so a re-captured owned item is not counted twice', () => {
  /**
   * Given two /summon/list/ captures: the first has two owned 0★ copies (param.id 1 and 2) of the
   * same summon, the second re-sends param.id 1 (e.g. the inventory page loaded twice),
   * When countInventoryDuplicates is called across both captures,
   * Then zeroStarCount is 2, not 3 — the repeated param.id 1 isn't double-counted.
   */
  const first = {
    url: 'https://game.granbluefantasy.jp/summon/list/2?...',
    responseBody: JSON.stringify({
      list: [
        { param: { id: 1, evolution: '0' }, master: { id: 2040158000 } },
        { param: { id: 2, evolution: '0' }, master: { id: 2040158000 } },
      ],
    }),
  };
  const second = {
    url: 'https://game.granbluefantasy.jp/summon/list/2?...',
    responseBody: JSON.stringify({ list: [{ param: { id: 1, evolution: '0' }, master: { id: 2040158000 } }] }),
  };
  const result = countInventoryDuplicates([first, second], '/summon/list/');
  assert.deepStrictEqual(result, [{ master_id: 2040158000, zeroStarCount: 2, nonZeroStars: [] }]);
});
