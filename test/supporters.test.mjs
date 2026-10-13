import test from 'node:test';
import assert from 'node:assert';
import { parseSupporters, parseFixedSummons, parseFriendList, mergeFriendHistory, findMissingSummons, groupLayout } from '../src/supporters.js';

// Same shape as a real /quest/content/supporter_raid/ block, trimmed to the fields we read.
function supporterBlock({ userId, name, summonId, summonName, level = 150, slot = 0, friend = true }) {
  return `<div class="btn-supporter lis-supporter" data-viewer-id="" data-supporter-user-id="${userId}" data-attribute="${slot}">`
    + `<div class="prt-supporter-name${friend ? ' ico-friend' : ''}"><span class="txt-supporter-name">${name}</span> <span class="txt-supporter-level">Rank 425</span></div>`
    + `<div class="prt-supporter-info"><div class="prt-summon-image" data-image="${summonId}"><img class="img-supporter-summon" alt="${summonId}" /></div>`
    + `<div class="prt-supporter-detail"><div class="prt-supporter-summon js-prt-supporter-summon"><span class="txt-summon-level">Lvl ${level}</span> <span class="js-summon-name">${summonName}</span></div></div></div>`
    + `</div>\n`;
}

function supporterCapture(blocks, trailingHtml = '') {
  return {
    url: 'https://game.granbluefantasy.jp/quest/content/supporter_raid/47007998137/2/0?_=1',
    responseBody: JSON.stringify({ data: encodeURIComponent(`<div class="prt-supporter-attribute type0">${blocks.join('')}</div>${trailingHtml}`) }),
  };
}

test('parseSupporters returns one record per friend support', () => {
  /**
   * Given a supporter_raid capture whose HTML holds two supports from friend ゆず (Kaguya Lvl 150 in
   * slot 20, Lucifer Lvl 250 in slot 15) and one support from a non-friend,
   * When parseSupporters is called on it,
   * Then it returns only the two friend supports, with userId, name, summonId, summonName, level and slot.
   */
  const friendId = '10733230';
  const friendName = 'ゆず';
  const capture = supporterCapture([
    supporterBlock({ userId: friendId, name: friendName, summonId: '2040114000', summonName: 'Kaguya', level: 150, slot: 20 }),
    supporterBlock({ userId: friendId, name: friendName, summonId: '2040056000', summonName: 'Lucifer', level: 250, slot: 15 }),
    supporterBlock({ userId: '99999999', name: 'stranger', summonId: '2040003000', summonName: 'Bahamut', friend: false }),
  ]);
  assert.deepStrictEqual(parseSupporters(capture), [
    { userId: friendId, name: friendName, summonId: '2040114000', summonName: 'Kaguya', level: 150, slot: 20 },
    { userId: friendId, name: friendName, summonId: '2040056000', summonName: 'Lucifer', level: 250, slot: 15 },
  ]);
});

test('parseSupporters strips the uncap art suffix from the summon id', () => {
  /**
   * Given a friend support whose data-image is '2040056000_04' (uncapped Lucifer art, as seen in
   * real captures),
   * When parseSupporters is called,
   * Then summonId is the bare '2040056000', so every uncap level counts as the same summon.
   */
  const summonId = '2040056000';
  const capture = supporterCapture([
    supporterBlock({ userId: '10733230', name: 'ゆず', summonId: `${summonId}_04`, summonName: 'Lucifer' }),
  ]);
  assert.strictEqual(parseSupporters(capture)[0].summonId, summonId);
});

test('parseSupporters ignores ico-friend text in the page templates after the last support', () => {
  /**
   * Given a capture whose last support is a non-friend, followed by the page's client-side
   * template that contains the literal text "ico-friend" (as in the real response),
   * When parseSupporters is called,
   * Then that non-friend is not returned.
   */
  const template = '<script type="text/template"><div class="prt-supporter-name<% if (supporter.friend_flg) { %> ico-friend<% }%>"></div></script>';
  const capture = supporterCapture(
    [supporterBlock({ userId: '21342208', name: 'stranger', summonId: '2040003000', summonName: 'Bahamut', friend: false })],
    template,
  );
  assert.deepStrictEqual(parseSupporters(capture), []);
});

test('parseSupporters returns nothing for a response without supporter HTML', () => {
  /**
   * Given a supporter_raid capture whose body is not JSON (e.g. an error page),
   * When parseSupporters is called,
   * Then it returns an empty array instead of throwing.
   */
  assert.deepStrictEqual(parseSupporters({ responseBody: '<html>error</html>' }), []);
});

test('mergeFriendHistory adds a newly seen friend with all their summons and one sighting', () => {
  /**
   * Given an empty friends store and one capture's supports: friend ゆず supporting Kaguya and Lucifer,
   * When mergeFriendHistory is called with that capture's time,
   * Then the store holds ゆず with both summons, 1 sighting (one capture, not one per support) and
   * lastSeen set to the capture time.
   */
  const userId = '10733230';
  const name = 'ゆず';
  const seenAt = 1791615993215;
  const supporters = [
    { userId, name, summonId: '2040114000', summonName: 'Kaguya', level: 150, slot: 20 },
    { userId, name, summonId: '2040056000', summonName: 'Lucifer', level: 250, slot: 15 },
  ];
  assert.deepStrictEqual(mergeFriendHistory({}, supporters, seenAt), {
    [userId]: {
      name,
      seenSummons: { 2040114000: 'Kaguya', 2040056000: 'Lucifer' },
      bestLevels: { 2040114000: 150, 2040056000: 250 },
      layout: { 20: { id: '2040114000', level: 150 }, 15: { id: '2040056000', level: 250 } },
      sightings: 1,
      lastSeen: seenAt,
    },
  });
});

test('mergeFriendHistory updates a known friend without losing earlier summons', () => {
  /**
   * Given a store where friend 10733230 (old name "yuzu") was seen once with Kaguya,
   * When a later capture shows them renamed ゆず and supporting Lucifer,
   * Then they keep Kaguya and gain Lucifer, sightings goes to 2, the name becomes ゆず and
   * lastSeen moves to the new capture time — and the original store object is left untouched.
   */
  const userId = '10733230';
  const newName = 'ゆず';
  const seenAt = 1791615993215;
  const friends = {
    [userId]: { name: 'yuzu', seenSummons: { 2040114000: 'Kaguya' }, bestLevels: { 2040114000: 150 }, layout: { 20: { id: '2040114000', level: 150 } }, sightings: 1, lastSeen: 1791000000000 },
  };
  const before = structuredClone(friends);
  const result = mergeFriendHistory(friends, [{ userId, name: newName, summonId: '2040056000', summonName: 'Lucifer', level: 250, slot: 15 }], seenAt);
  assert.deepStrictEqual(result[userId], {
    name: newName,
    seenSummons: { 2040114000: 'Kaguya', 2040056000: 'Lucifer' },
    bestLevels: { 2040114000: 150, 2040056000: 250 },
    layout: { 20: { id: '2040114000', level: 150 }, 15: { id: '2040056000', level: 250 } },
    sightings: 2,
    lastSeen: seenAt,
  });
  assert.deepStrictEqual(friends, before, 'the input store must not be mutated');
});

test('mergeFriendHistory keeps the highest level seen for each summon', () => {
  /**
   * Given a friend tracked before levels existed (no bestLevels field), later seen with Hades Lvl 250,
   * When a newer capture shows them with Hades Lvl 230,
   * Then their best Hades level stays 250 — a lower-level support doesn't erase a better one.
   */
  const userId = '10733230';
  const hades = '2040090000';
  const legacy = { [userId]: { name: 'ゆず', seenSummons: {}, sightings: 1, lastSeen: 1 } };
  const after250 = mergeFriendHistory(legacy, [{ userId, name: 'ゆず', summonId: hades, summonName: 'Hades', level: 250 }], 2);
  const after230 = mergeFriendHistory(after250, [{ userId, name: 'ゆず', summonId: hades, summonName: 'Hades', level: 230 }], 3);
  assert.deepStrictEqual(after230[userId].bestLevels, { [hades]: 250 });
});

test('mergeFriendHistory updates only the layout slots shown in the new capture', () => {
  /**
   * Given a friend whose known layout is Hades Lvl 230 in slot 6 (Dark) and Lucifer Lvl 250 in slot 15,
   * When a new capture shows only slot 6, now Hades Lvl 250,
   * Then slot 6 becomes Hades Lvl 250 and slot 15 keeps Lucifer — a slot missing from one capture
   * keeps its last known summon.
   */
  const userId = '10733230';
  const hades = { id: '2040090000', level: 230 };
  const lucifer = { id: '2040056000', level: 250 };
  const friends = {
    [userId]: { name: 'ゆず', seenSummons: {}, bestLevels: {}, layout: { 6: hades, 15: lucifer }, sightings: 1, lastSeen: 1 },
  };
  const result = mergeFriendHistory(friends, [{ userId, name: 'ゆず', summonId: hades.id, summonName: 'Hades', level: 250, slot: 6 }], 2);
  assert.deepStrictEqual(result[userId].layout, { 6: { id: hades.id, level: 250 }, 15: lucifer });
});

const LUCIFER = '2040056000';
const BAHAMUT = '2040003000';

function friendRecord(name, summonIds, sightings = 1) {
  return { name, seenSummons: Object.fromEntries(summonIds.map(id => [id, `summon ${id}`])), sightings, lastSeen: 1791615993215 };
}

test('findMissingSummons returns friends missing a watched summon, with which ones are missing', () => {
  /**
   * Given friend A seen with Lucifer only and friend B seen with both Lucifer and Bahamut,
   * When findMissingSummons is called watching Lucifer and Bahamut,
   * Then only A is returned, with missing = [Bahamut] alongside their stored history.
   */
  const friendA = friendRecord('A', [LUCIFER]);
  const friends = { 1: friendA, 2: friendRecord('B', [LUCIFER, BAHAMUT]) };
  assert.deepStrictEqual(findMissingSummons(friends, [LUCIFER, BAHAMUT]), [
    { userId: '1', ...friendA, missing: [BAHAMUT] },
  ]);
});

test('findMissingSummons lists the most-seen friends first', () => {
  /**
   * Given two friends both missing Lucifer, one seen 1 time and one seen 5 times,
   * When findMissingSummons is called watching Lucifer,
   * Then the friend seen 5 times comes first, since more sightings make the gap more certain.
   */
  const friends = { 1: friendRecord('rarely seen', [], 1), 2: friendRecord('often seen', [], 5) };
  assert.deepStrictEqual(findMissingSummons(friends, [LUCIFER]).map(f => f.name), ['often seen', 'rarely seen']);
});

const HADES = '2040090000';

test('findMissingSummons flags a friend whose best level is below the minimum', () => {
  /**
   * Given friend A whose best Hades is Lvl 230 and friend B whose best Hades is Lvl 250,
   * When findMissingSummons is called watching Hades with a minimum level of 250,
   * Then only A is flagged, with Hades missing.
   */
  const friends = {
    1: { ...friendRecord('A', [HADES]), bestLevels: { [HADES]: 230 } },
    2: { ...friendRecord('B', [HADES]), bestLevels: { [HADES]: 250 } },
  };
  const result = findMissingSummons(friends, [HADES], { [HADES]: 250 });
  assert.deepStrictEqual(result.map(f => [f.name, f.missing]), [['A', [HADES]]]);
});

test('findMissingSummons flags a friend with no recorded level when a minimum is set', () => {
  /**
   * Given a friend tracked before levels existed: seen with Hades, but no bestLevels field,
   * When findMissingSummons is called watching Hades with a minimum level of 250,
   * Then they are flagged — an unknown level can't be shown to meet the minimum.
   */
  const friends = { 1: friendRecord('legacy', [HADES]) };
  assert.deepStrictEqual(findMissingSummons(friends, [HADES], { [HADES]: 250 }).map(f => f.missing), [[HADES]]);
});

test('groupLayout groups slots by element tab in game order, rows sorted', () => {
  /**
   * Given a layout with Lucifer in slot 15 (Light row 1), Zeus in slot 5 (Light row 0) and
   * Kaguya in slot 20 (Misc row 2),
   * When groupLayout is called,
   * Then it returns all 7 tabs in game order (Fire … Dark, Misc), Light holding Zeus then Lucifer,
   * Misc holding Kaguya, and every other tab empty.
   */
  const zeus = { id: '2040183000', level: 250 };
  const lucifer = { id: '2040056000', level: 250 };
  const kaguya = { id: '2040114000', level: 150 };
  assert.deepStrictEqual(groupLayout({ 15: lucifer, 5: zeus, 20: kaguya }), [
    { element: 'Fire', slots: [] },
    { element: 'Water', slots: [] },
    { element: 'Earth', slots: [] },
    { element: 'Wind', slots: [] },
    { element: 'Light', slots: [zeus, lucifer] },
    { element: 'Dark', slots: [] },
    { element: 'Misc', slots: [kaguya] },
  ]);
});

// Same shape as a real /friend/friend_fixed_summon/{userId} entry, trimmed to the fields we read.
function fixedSummon({ masterId = null, name = null, level = null, slot }) {
  return { fixed_summon_info: { master_id: masterId, name, level, attribute_key: slot }, fix_status: masterId ? 1 : 0 };
}

test('parseFixedSummons returns one record per filled slot of a friend\'s Details', () => {
  /**
   * Given a friend_fixed_summon capture for friend 1358003 holding Lucifer Lvl 250 in slot 30,
   * Agni Lvl 250 in slot 11 and an empty slot 21,
   * When parseFixedSummons is called on it,
   * Then it returns the two filled slots with the friend's id from the URL, and skips the empty one.
   */
  const userId = '1358003';
  const capture = {
    url: `https://game.granbluefantasy.jp/friend/friend_fixed_summon/${userId}?_=1791847047336&t=1791847490243&uid=26271737`,
    responseBody: JSON.stringify({
      fixed_summon_list: [
        [fixedSummon({ masterId: '2040056000', name: 'Lucifer', level: '250', slot: 30 })],
        [fixedSummon({ masterId: '2040094000', name: 'Agni', level: '250', slot: 11 }), fixedSummon({ slot: 21 })],
      ],
    }),
  };
  assert.deepStrictEqual(parseFixedSummons(capture), [
    { userId, summonId: '2040056000', summonName: 'Lucifer', level: 250, slot: 30 },
    { userId, summonId: '2040094000', summonName: 'Agni', level: 250, slot: 11 },
  ]);
});

test('mergeFriendHistory replaces the whole layout with a friend\'s Details', () => {
  /**
   * Given a friend whose known layout is Hades Lvl 230 in slot 6 and Lucifer Lvl 250 in slot 15,
   * When a Details capture is merged showing only Hades Lvl 250 in slot 6 (slot 15 is empty there),
   * Then the layout is just slot 6 with Hades Lvl 250 — Details shows every slot, so slot 15 was emptied.
   */
  const userId = '10733230';
  const hades = { id: '2040090000', level: 250 };
  const friends = {
    [userId]: { name: 'ゆず', seenSummons: {}, bestLevels: {}, layout: { 6: { id: hades.id, level: 230 }, 15: { id: '2040056000', level: 250 } }, sightings: 1, lastSeen: 1 },
  };
  const details = [{ userId, summonId: hades.id, summonName: 'Hades', level: hades.level, slot: 6 }];
  const result = mergeFriendHistory(friends, details, 2, { fromDetails: true });
  assert.deepStrictEqual(result[userId].layout, { 6: hades });
});

test('mergeFriendHistory does not count a friend\'s Details as a sighting', () => {
  /**
   * Given a friend seen 3 times, last at time 1,
   * When a Details capture taken at time 2 is merged,
   * Then sightings stays 3 and lastSeen stays 1 — sightings count supporter pages only.
   */
  const userId = '10733230';
  const sightings = 3;
  const lastSeen = 1;
  const friends = { [userId]: { name: 'ゆず', seenSummons: {}, bestLevels: {}, layout: {}, sightings, lastSeen } };
  const details = [{ userId, summonId: '2040090000', summonName: 'Hades', level: 250, slot: 6 }];
  const result = mergeFriendHistory(friends, details, 2, { fromDetails: true });
  assert.deepStrictEqual([result[userId].sightings, result[userId].lastSeen], [sightings, lastSeen]);
});

test('mergeFriendHistory keeps the stored name when the support has none', () => {
  /**
   * Given a friend stored as ゆず,
   * When a Details capture is merged whose records carry no name (that response has none),
   * Then the friend is still named ゆず.
   */
  const userId = '10733230';
  const name = 'ゆず';
  const friends = { [userId]: { name, seenSummons: {}, bestLevels: {}, layout: {}, sightings: 1, lastSeen: 1 } };
  const details = [{ userId, summonId: '2040090000', summonName: 'Hades', level: 250, slot: 6 }];
  assert.strictEqual(mergeFriendHistory(friends, details, 2, { fromDetails: true })[userId].name, name);
});

test('parseFriendList maps each listed friend\'s id to their name', () => {
  /**
   * Given a friend_list page listing ゆず (10733230) and Haaselia (11279725),
   * When parseFriendList is called on it,
   * Then it returns {10733230: 'ゆず', 11279725: 'Haaselia'}, keyed by the same id as supporter pages.
   */
  const capture = {
    url: 'https://game.granbluefantasy.jp/friend/friend_list/1?_=1791915437329&t=1791915437757&uid=26271737',
    responseBody: JSON.stringify({
      list: [
        { id: '10733230', viewer_id: '132354087', name: 'ゆず' },
        { id: '11279725', viewer_id: '133459402', name: 'Haaselia' },
      ],
    }),
  };
  assert.deepStrictEqual(parseFriendList(capture), { 10733230: 'ゆず', 11279725: 'Haaselia' });
});

test('mergeFriendHistory adds a friend first seen through their Details without a sighting', () => {
  /**
   * Given an empty friends store,
   * When a Details capture for hez (named from the friend list) is merged,
   * Then hez is added with 0 sightings and no lastSeen, since no supporter page has shown them yet.
   */
  const userId = '1358003';
  const details = [{ userId, name: 'hez', summonId: '2040056000', summonName: 'Lucifer', level: 250, slot: 30 }];
  const friend = mergeFriendHistory({}, details, 2, { fromDetails: true })[userId];
  assert.deepStrictEqual([friend.name, friend.sightings, friend.lastSeen], ['hez', 0, undefined]);
});
