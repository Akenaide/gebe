import test from 'node:test';
import assert from 'node:assert';
import { countCrateDuplicates, countInventoryDuplicates, combineDuplicateSections, extractItems } from '../src/itemStats.js';

test('countCrateDuplicates counts repeated regular_id among crate items of the given item_kind_id', () => {
  /**
   * Given a crate holding two distinct Tetragod presents (same regular_id 2040435000, as in the
   * real present.json, but two different present ids), one Shiva, and one weapon (item_kind_id '1')
   * that must be ignored when querying for kind '2',
   * When countCrateDuplicates is called with itemKindId '2',
   * Then Tetragod is reported with count 2 and Shiva with count 1, and the weapon does not appear.
   */
  const crate = {
    6891474499: { item_kind_id: '2', regular_id: 2040435000, item_name: 'Tetragod', attribute: '1' },
    6903804131: { item_kind_id: '2', regular_id: 2040435000, item_name: 'Tetragod', attribute: '1' },
    6919948785: { item_kind_id: '2', regular_id: 2040185000, item_name: 'Shiva', attribute: '5' },
    7000000001: { item_kind_id: '1', regular_id: 1040000000, item_name: 'Some Weapon', attribute: '1' },
  };
  const result = countCrateDuplicates(crate, '2');
  assert.deepStrictEqual(result, [
    { regular_id: 2040435000, item_name: 'Tetragod', attribute_name: 'Fire', count: 2 },
    { regular_id: 2040185000, item_name: 'Shiva', attribute_name: 'Light', count: 1 },
  ]);
});

test('countCrateDuplicates resolves attribute_name from a hardcoded attribute-code table', () => {
  /**
   * Given a crate item with attribute '3',
   * When countCrateDuplicates is called,
   * Then the returned row's attribute_name is "Earth", resolved from the app's own fixed mapping
   * (not from the response's sort map, which isn't trusted).
   */
  const crate = { x: { item_kind_id: '2', regular_id: 9, item_name: 'Earth Thing', attribute: '3' } };
  const result = countCrateDuplicates(crate, '2');
  assert.deepStrictEqual(result, [{ regular_id: 9, item_name: 'Earth Thing', attribute_name: 'Earth', count: 1 }]);
});

test('countCrateDuplicates defaults attribute_name to null for an unrecognized attribute code', () => {
  /**
   * Given a crate item with an attribute code that isn't in the app's fixed mapping (e.g. '9'),
   * When countCrateDuplicates is called,
   * Then the returned row's attribute_name is null instead of throwing or being undefined.
   */
  const crate = { x: { item_kind_id: '2', regular_id: 9, item_name: 'Mystery Thing', attribute: '9' } };
  const result = countCrateDuplicates(crate, '2');
  assert.deepStrictEqual(result, [{ regular_id: 9, item_name: 'Mystery Thing', attribute_name: null, count: 1 }]);
});

test('countInventoryDuplicates splits a 0★ copy and a 1★ copy of the same summon', () => {
  /**
   * Given two owned copies of the same summon (master_id 2040158000): one at 0 uncap stars and
   * one at 1 uncap star,
   * When countInventoryDuplicates is called,
   * Then zeroStarCount is 1 and nonZeroStars lists the single 1★ copy by its own id.
   */
  const owned = {
    1243639174: { master_id: 2040158000, evolution: 0 },
    1208254746: { master_id: 2040158000, evolution: 1 },
  };
  const result = countInventoryDuplicates(owned);
  assert.deepStrictEqual(result, [
    { master_id: 2040158000, zeroStarCount: 1, nonZeroStars: [{ param_id: 1208254746, evolution: 1 }] },
  ]);
});

test('countInventoryDuplicates lists every non-0★ copy individually, matching the real 4x duplicate seen in inventory-summon.json', () => {
  /**
   * Given four owned 3★ copies sharing master_id 2040158000 (the real duplicate from
   * inventory-summon.json),
   * When countInventoryDuplicates is called,
   * Then zeroStarCount is 0 and nonZeroStars lists all four copies individually at evolution 3,
   * not a single folded number.
   */
  const copyIds = [1067755759, 1091463657, 1208254746, 1243639174];
  const owned = Object.fromEntries(copyIds.map(id => [id, { master_id: 2040158000, evolution: 3 }]));
  const result = countInventoryDuplicates(owned);
  assert.deepStrictEqual(result, [
    { master_id: 2040158000, zeroStarCount: 0, nonZeroStars: copyIds.map(param_id => ({ param_id, evolution: 3 })) },
  ]);
});

test('countInventoryDuplicates includes a master_id with only one owned copy, since single copies stay listed', () => {
  /**
   * Given a single owned copy of a summon,
   * When countInventoryDuplicates is called,
   * Then it is still returned — a single inventory copy might combine with crate presents of the
   * same summon into an overall duplicate, so this function must not filter it out on its own.
   */
  const result = countInventoryDuplicates({ 1: { master_id: 2040158000, evolution: 0 } });
  assert.deepStrictEqual(result, [{ master_id: 2040158000, zeroStarCount: 1, nonZeroStars: [] }]);
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
  const crateDuplicates = [{ regular_id: 2040158000, item_name: 'Shiva', attribute_name: 'Light', count: 2 }];
  const inventoryDuplicates = [{ master_id: 2040158000, zeroStarCount: 1, nonZeroStars: [{ param_id: 1, evolution: 1 }] }];
  const result = combineDuplicateSections(crateDuplicates, inventoryDuplicates);
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
  const crateDuplicates = [{ regular_id: 333, item_name: 'Test Summon', attribute_name: 'Water', count: 2 }];
  const inventoryDuplicates = [{ master_id: 333, zeroStarCount: 1, nonZeroStars: [] }];
  const result = combineDuplicateSections(crateDuplicates, inventoryDuplicates);
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
   * Given a /present/list/ capture with two unclaimed Tetragod presents (attribute '1' → "Fire")
   * and a /summon/list/ capture with two owned copies of the same Tetragod (master.id 2040435000,
   * same numeric id as the crate's regular_id: one 0★ and one 1★),
   * When both are run through extractItems, then countCrateDuplicates, countInventoryDuplicates
   * and combineDuplicateSections (the pipeline devtools.js and panel.js use),
   * Then a single merged row for id 2040435000 carries the crate count, attribute_name, and the
   * inventory star breakdown — not two separate rows.
   */
  const summonId = 2040435000;
  const { crate } = extractItems({
    url: 'https://game.granbluefantasy.jp/present/list/2/0/1',
    responseBody: JSON.stringify({
      list: [
        { id: 'p1', item_kind_id: '2', regular_id: summonId, item_name: 'Tetragod', rarity: '4', attribute: '1' },
        { id: 'p2', item_kind_id: '2', regular_id: summonId, item_name: 'Tetragod', rarity: '4', attribute: '1' },
      ],
    }),
  });
  const { ownedSummons } = extractItems({
    url: 'https://game.granbluefantasy.jp/summon/list/2?...',
    responseBody: JSON.stringify({
      list: [
        { param: { id: 1, evolution: '0' }, master: { id: summonId, rarity: '4' } },
        { param: { id: 2, evolution: '1' }, master: { id: summonId, rarity: '4' } },
      ],
    }),
  });
  const result = combineDuplicateSections(countCrateDuplicates(crate, '2'), countInventoryDuplicates(ownedSummons));
  assert.deepStrictEqual(result, [
    {
      id: summonId,
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
  const crateDuplicates = [
    { regular_id: 1, item_name: 'Shiva', attribute_name: 'Light', count: 2 },
    { regular_id: 2, item_name: 'Michael', attribute_name: 'Light', count: 2 },
  ];
  const result = combineDuplicateSections(crateDuplicates, []);
  assert.deepStrictEqual(result.map(r => r.id), [2, 1]);
});

test('extractItems keeps only SS Rare presents from a present-list capture, keyed by present id', () => {
  /**
   * Given a /present/list/ capture holding one SS Rare Tetragod present and one S Rare present,
   * When extractItems is called,
   * Then it returns a crate holding only the Tetragod, keyed by its present id, with just the
   * fields the panel needs.
   */
  const presentId = '6891474499';
  const capture = {
    url: 'https://game.granbluefantasy.jp/present/list/2/0/1?_=1',
    responseBody: JSON.stringify({
      list: [
        { id: presentId, item_kind_id: '2', regular_id: 2040435000, item_name: 'Tetragod', rarity: '4', attribute: '1', extra: 'x' },
        { id: '7', item_kind_id: '2', regular_id: 2, item_name: 'S Rare Thing', rarity: '3', attribute: '2' },
      ],
    }),
  };
  const result = extractItems(capture);
  assert.deepStrictEqual(result, {
    crate: { [presentId]: { item_kind_id: '2', regular_id: 2040435000, item_name: 'Tetragod', attribute: '1' } },
  });
});

test('extractItems keeps only SS Rare owned copies from a summon-list capture, keyed by owned-copy id', () => {
  /**
   * Given a /summon/list/ capture holding one SS Rare 1★ copy of a summon and one S Rare copy,
   * When extractItems is called,
   * Then it returns ownedSummons holding only the SS Rare copy, keyed by its own param.id, with
   * which summon it is and its uncap stars as a number.
   */
  const copyId = 1208254746;
  const summonId = 2040158000;
  const capture = {
    url: 'https://game.granbluefantasy.jp/summon/list/2?_=1',
    responseBody: JSON.stringify({
      list: [
        { param: { id: copyId, evolution: '1' }, master: { id: summonId, rarity: '4' } },
        { param: { id: 3, evolution: '0' }, master: { id: 200, rarity: '3' } },
      ],
    }),
  };
  const result = extractItems(capture);
  assert.deepStrictEqual(result, { ownedSummons: { [copyId]: { master_id: summonId, evolution: 1 } } });
});

test('extractItems puts SS Rare copies from a weapon-list capture into ownedWeapons', () => {
  /**
   * Given a /weapon/list/ capture holding one SS Rare 0★ weapon copy,
   * When extractItems is called,
   * Then it returns ownedWeapons (not ownedSummons) holding that copy keyed by its param.id.
   */
  const copyId = 55;
  const weaponId = 1040000000;
  const capture = {
    url: 'https://game.granbluefantasy.jp/weapon/list/2?_=1',
    responseBody: JSON.stringify({ list: [{ param: { id: copyId, evolution: '0' }, master: { id: weaponId, rarity: '4' } }] }),
  };
  const result = extractItems(capture);
  assert.deepStrictEqual(result, { ownedWeapons: { [copyId]: { master_id: weaponId, evolution: 0 } } });
});

test('extractItems returns nothing for a capture from another game endpoint', () => {
  /**
   * Given a capture from an unrelated endpoint whose response happens to hold an SS Rare-looking list,
   * When extractItems is called,
   * Then it returns an empty object, so nothing is stored.
   */
  const capture = {
    url: 'https://game.granbluefantasy.jp/quest/assist_list?_=1',
    responseBody: JSON.stringify({ list: [{ id: '1', item_kind_id: '2', regular_id: 9, item_name: 'X', rarity: '4', attribute: '1' }] }),
  };
  assert.deepStrictEqual(extractItems(capture), {});
});

test('extractItems returns nothing when a present-list response is not JSON', () => {
  /**
   * Given a /present/list/ capture whose response body is not valid JSON (e.g. an error page),
   * When extractItems is called,
   * Then it returns an empty object instead of throwing.
   */
  const capture = { url: 'https://game.granbluefantasy.jp/present/list/2/0/1', responseBody: 'not json' };
  assert.deepStrictEqual(extractItems(capture), {});
});
