import test from 'node:test';
import assert from 'node:assert';
import { countCrateDuplicates, countInventoryDuplicates, combineDuplicateSections } from '../src/itemStats.js';

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
      { id: '6891474499', item_kind_id: '2', regular_id: 2040435000, item_name: 'Tetragod', rarity: '4', attribute: '1' },
      { id: '6903804131', item_kind_id: '2', regular_id: 2040435000, item_name: 'Tetragod', rarity: '4', attribute: '1' },
      { id: '6919948785', item_kind_id: '2', regular_id: 2040185000, item_name: 'Shiva', rarity: '4', attribute: '5' },
      { id: '7000000001', item_kind_id: '1', regular_id: 1040000000, item_name: 'Some Weapon' },
    ],
  });
  const result = countCrateDuplicates([{ responseBody }], '2');
  assert.deepStrictEqual(result, [
    { regular_id: 2040435000, item_name: 'Tetragod', attribute_name: 'Fire', count: 2 },
    { regular_id: 2040185000, item_name: 'Shiva', attribute_name: 'Light', count: 1 },
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
    list: [{ id: '6891474499', item_kind_id: '2', regular_id: 2040435000, item_name: 'Tetragod', rarity: '4', attribute: '1' }],
  });
  const result = countCrateDuplicates([{ responseBody: makeBody() }, { responseBody: makeBody() }], '2');
  assert.deepStrictEqual(result, [{ regular_id: 2040435000, item_name: 'Tetragod', attribute_name: 'Fire', count: 1 }]);
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

test('countCrateDuplicates ignores items whose rarity is not 4 (SS Rare)', () => {
  /**
   * Given two rarity-4 Tetragod presents and two rarity-3 "S Rare Thing" presents, both matching
   * item_kind_id '2',
   * When countCrateDuplicates is called with itemKindId '2',
   * Then only the rarity-4 Tetragod duplicate is reported; the rarity-3 duplicate is excluded.
   */
  const responseBody = JSON.stringify({
    list: [
      { id: 'a', item_kind_id: '2', regular_id: 1, item_name: 'Tetragod', rarity: '4', attribute: '1' },
      { id: 'b', item_kind_id: '2', regular_id: 1, item_name: 'Tetragod', rarity: '4', attribute: '1' },
      { id: 'c', item_kind_id: '2', regular_id: 2, item_name: 'S Rare Thing', rarity: '3', attribute: '2' },
      { id: 'd', item_kind_id: '2', regular_id: 2, item_name: 'S Rare Thing', rarity: '3', attribute: '2' },
    ],
  });
  const result = countCrateDuplicates([{ responseBody }], '2');
  assert.deepStrictEqual(result, [{ regular_id: 1, item_name: 'Tetragod', attribute_name: 'Fire', count: 2 }]);
});

test('countCrateDuplicates resolves attribute_name from a hardcoded attribute-code table, not the response', () => {
  /**
   * Given an item with attribute '3' and a response that carries no sort map at all (unlike the
   * real present.json shape, on purpose — the resolution must not depend on the response),
   * When countCrateDuplicates is called,
   * Then the returned row's attribute_name is "Earth", resolved from the app's own fixed mapping.
   */
  const responseBody = JSON.stringify({
    list: [{ id: 'x', item_kind_id: '2', regular_id: 9, item_name: 'Earth Thing', rarity: '4', attribute: '3' }],
  });
  const result = countCrateDuplicates([{ responseBody }], '2');
  assert.deepStrictEqual(result, [{ regular_id: 9, item_name: 'Earth Thing', attribute_name: 'Earth', count: 1 }]);
});

test('countCrateDuplicates defaults attribute_name to null for an unrecognized attribute code', () => {
  /**
   * Given an item with an attribute code that isn't in the app's fixed mapping (e.g. '9'),
   * When countCrateDuplicates is called,
   * Then the returned row's attribute_name is null instead of throwing or being undefined.
   */
  const responseBody = JSON.stringify({
    list: [{ id: 'x', item_kind_id: '2', regular_id: 9, item_name: 'Mystery Thing', rarity: '4', attribute: '9' }],
  });
  const result = countCrateDuplicates([{ responseBody }], '2');
  assert.deepStrictEqual(result, [{ regular_id: 9, item_name: 'Mystery Thing', attribute_name: null, count: 1 }]);
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
      { param: { id: 1243639174, evolution: '0' }, master: { id: 2040158000, rarity: '4' } },
      { param: { id: 1208254746, evolution: '1' }, master: { id: 2040158000, rarity: '4' } },
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
      { param: { id: 1243639174, evolution: '3' }, master: { id: 2040158000, rarity: '4' } },
      { param: { id: 1208254746, evolution: '3' }, master: { id: 2040158000, rarity: '4' } },
      { param: { id: 1091463657, evolution: '3' }, master: { id: 2040158000, rarity: '4' } },
      { param: { id: 1067755759, evolution: '3' }, master: { id: 2040158000, rarity: '4' } },
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

test('countInventoryDuplicates ignores owned copies whose master.rarity is not 4 (SS Rare)', () => {
  /**
   * Given two owned copies of a rarity-4 summon and one owned copy of a rarity-3 summon,
   * When countInventoryDuplicates is called,
   * Then only the rarity-4 summon's group is returned; the rarity-3 copy is excluded entirely.
   */
  const responseBody = JSON.stringify({
    list: [
      { param: { id: 1, evolution: '0' }, master: { id: 100, rarity: '4' } },
      { param: { id: 2, evolution: '0' }, master: { id: 100, rarity: '4' } },
      { param: { id: 3, evolution: '0' }, master: { id: 200, rarity: '3' } },
    ],
  });
  const entry = { url: 'https://game.granbluefantasy.jp/summon/list/2?...', responseBody };
  const result = countInventoryDuplicates([entry], '/summon/list/');
  assert.deepStrictEqual(result, [{ master_id: 100, zeroStarCount: 2, nonZeroStars: [] }]);
});

test('countInventoryDuplicates includes a master.id with only one owned copy (filtering happens later, at the combined-total level)', () => {
  /**
   * Given a single owned copy of a summon,
   * When countInventoryDuplicates is called,
   * Then it is still returned — a single inventory copy might combine with crate presents of the
   * same summon into an overall duplicate, so this function must not filter it out on its own.
   */
  const responseBody = JSON.stringify({
    list: [{ param: { id: 1, evolution: '0' }, master: { id: 2040158000, rarity: '4' } }],
  });
  const entry = { url: 'https://game.granbluefantasy.jp/summon/list/2?...', responseBody };
  const result = countInventoryDuplicates([entry], '/summon/list/');
  assert.deepStrictEqual(result, [{ master_id: 2040158000, zeroStarCount: 1, nonZeroStars: [] }]);
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
        { param: { id: 1, evolution: '0' }, master: { id: 2040158000, rarity: '4' } },
        { param: { id: 2, evolution: '0' }, master: { id: 2040158000, rarity: '4' } },
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
        { param: { id: 1, evolution: '0' }, master: { id: 2040158000, rarity: '4' } },
        { param: { id: 2, evolution: '0' }, master: { id: 2040158000, rarity: '4' } },
      ],
    }),
  };
  const second = {
    url: 'https://game.granbluefantasy.jp/summon/list/2?...',
    responseBody: JSON.stringify({ list: [{ param: { id: 1, evolution: '0' }, master: { id: 2040158000, rarity: '4' } }] }),
  };
  const result = countInventoryDuplicates([first, second], '/summon/list/');
  assert.deepStrictEqual(result, [{ master_id: 2040158000, zeroStarCount: 2, nonZeroStars: [] }]);
});

test('combineDuplicateSections merges a crate duplicate and an inventory duplicate of the same summon into one row', () => {
  /**
   * Given a crate duplicate for regular_id 2040158000 named "Shiva" (attribute_name "Light") and
   * an inventory duplicate for the same id (master_id 2040158000, same numeric space as
   * regular_id),
   * When combineDuplicateSections is called with both,
   * Then one row is returned carrying the item_name and attribute_name from the crate side and
   * the star breakdown from the inventory side.
   */
  const crateDupes = [{ regular_id: 2040158000, item_name: 'Shiva', attribute_name: 'Light', count: 2 }];
  const inventoryDupes = [{ master_id: 2040158000, zeroStarCount: 1, nonZeroStars: [{ param_id: 1, evolution: 1 }] }];
  const result = combineDuplicateSections(crateDupes, inventoryDupes);
  assert.deepStrictEqual(result, [
    {
      id: 2040158000,
      item_name: 'Shiva',
      attribute_name: 'Light',
      crateCount: 2,
      zeroStarCount: 1,
      nonZeroStars: [{ param_id: 1, evolution: 1 }],
    },
  ]);
});

test('combineDuplicateSections includes a crate-only duplicate with no inventory data', () => {
  /**
   * Given only a crate duplicate (the summon hasn't been claimed yet, so it has no inventory
   * entry at all),
   * When combineDuplicateSections is called,
   * Then the row is still returned, with zeroStarCount 0 and an empty nonZeroStars.
   */
  const result = combineDuplicateSections([{ regular_id: 111, item_name: 'Tetragod', attribute_name: 'Fire', count: 2 }], []);
  assert.deepStrictEqual(result, [
    { id: 111, item_name: 'Tetragod', attribute_name: 'Fire', crateCount: 2, zeroStarCount: 0, nonZeroStars: [] },
  ]);
});

test('combineDuplicateSections includes an inventory-only duplicate with no crate item_name or attribute_name', () => {
  /**
   * Given only an inventory duplicate (already claimed, no unclaimed presents of it), which has
   * no item_name or attribute field at all in its own shape,
   * When combineDuplicateSections is called,
   * Then the row is returned with crateCount 0, item_name null, and attribute_name null.
   */
  const result = combineDuplicateSections([], [{ master_id: 222, zeroStarCount: 2, nonZeroStars: [] }]);
  assert.deepStrictEqual(result, [
    { id: 222, item_name: null, attribute_name: null, crateCount: 0, zeroStarCount: 2, nonZeroStars: [] },
  ]);
});

test('combineDuplicateSections merges 2 unclaimed crate presents with 1 owned inventory copy into one row', () => {
  /**
   * Given exactly 2 unclaimed crate presents of a summon and exactly 1 owned inventory copy of
   * the same summon (matching the reported case: "1 in inventory and 2 in crate"),
   * When combineDuplicateSections is called,
   * Then the merged row carries crateCount 2 and zeroStarCount 1 together, not as two separate
   * rows and not with the inventory copy silently dropped.
   */
  const crateDupes = [{ regular_id: 333, item_name: 'Test Summon', attribute_name: 'Water', count: 2 }];
  const inventoryDupes = [{ master_id: 333, zeroStarCount: 1, nonZeroStars: [] }];
  const result = combineDuplicateSections(crateDupes, inventoryDupes);
  assert.deepStrictEqual(result, [
    { id: 333, item_name: 'Test Summon', attribute_name: 'Water', crateCount: 2, zeroStarCount: 1, nonZeroStars: [] },
  ]);
});

test('combineDuplicateSections includes a summon with only a single owned copy and no unclaimed presents', () => {
  /**
   * Given a single owned inventory copy of a summon and no unclaimed crate presents of it,
   * When combineDuplicateSections is called,
   * Then the row is still returned — every captured summon shows, not just duplicates.
   */
  const result = combineDuplicateSections([], [{ master_id: 444, zeroStarCount: 1, nonZeroStars: [] }]);
  assert.deepStrictEqual(result, [
    { id: 444, item_name: null, attribute_name: null, crateCount: 0, zeroStarCount: 1, nonZeroStars: [] },
  ]);
});

test('crate and inventory duplicates of the same real summon merge into one row through the full pipeline', () => {
  /**
   * Given a captured /present/list/ entry with two unclaimed Tetragod presents (attribute '1',
   * resolved to "Fire" via the app's own fixed attribute-code table) and a captured /summon/list/
   * entry with two owned copies of the same Tetragod (master.id 2040435000, same numeric id as
   * the crate's regular_id: one 0★ and one 1★),
   * When the entries are run through countCrateDuplicates, countInventoryDuplicates, and
   * combineDuplicateSections in sequence (the exact pipeline panel.js uses),
   * Then a single merged row for id 2040435000 carries the crate count, attribute_name, and the
   * inventory star breakdown — not two separate rows.
   */
  const crateEntry = {
    responseBody: JSON.stringify({
      list: [
        { id: 'p1', item_kind_id: '2', regular_id: 2040435000, item_name: 'Tetragod', rarity: '4', attribute: '1' },
        { id: 'p2', item_kind_id: '2', regular_id: 2040435000, item_name: 'Tetragod', rarity: '4', attribute: '1' },
      ],
    }),
  };
  const inventoryEntry = {
    url: 'https://game.granbluefantasy.jp/summon/list/2?...',
    responseBody: JSON.stringify({
      list: [
        { param: { id: 1, evolution: '0' }, master: { id: 2040435000, rarity: '4' } },
        { param: { id: 2, evolution: '1' }, master: { id: 2040435000, rarity: '4' } },
      ],
    }),
  };
  const crateDupes = countCrateDuplicates([crateEntry], '2');
  const inventoryDupes = countInventoryDuplicates([inventoryEntry], '/summon/list/');
  const result = combineDuplicateSections(crateDupes, inventoryDupes);
  assert.deepStrictEqual(result, [
    {
      id: 2040435000,
      item_name: 'Tetragod',
      attribute_name: 'Fire',
      crateCount: 2,
      zeroStarCount: 1,
      nonZeroStars: [{ param_id: 2, evolution: 1 }],
    },
  ]);
});

test('combineDuplicateSections sorts rows ascending by item_name, falling back to id as text when there is no name', () => {
  /**
   * Given a crate duplicate named "Shiva" and a crate duplicate named "Michael",
   * When combineDuplicateSections is called,
   * Then the rows come back sorted ascending by name: "Michael" before "Shiva".
   */
  const crateDupes = [
    { regular_id: 1, item_name: 'Shiva', attribute_name: 'Light', count: 2 },
    { regular_id: 2, item_name: 'Michael', attribute_name: 'Light', count: 2 },
  ];
  const result = combineDuplicateSections(crateDupes, []);
  assert.deepStrictEqual(result.map(r => r.id), [2, 1]);
});
