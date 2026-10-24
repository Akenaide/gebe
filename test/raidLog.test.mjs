import test from 'node:test';
import assert from 'node:assert';
import { parseRaidStart, mergeRaidStart, RAID_LOG_LIMIT, parseBattleLog, backfillRaidLog, applyPageState } from '../src/raidLog.js';

// Same shape as a real /rest/multiraid/start.json, trimmed to the fields we read.
function startCapture({ raidId, battleId, monster, hp, hpmax, members }) {
  return {
    url: 'https://game.granbluefantasy.jp/rest/multiraid/start.json?_=1',
    responseBody: JSON.stringify({
      raid_id: Number(raidId),
      boss: { param: [{ name: { ja: 'Lv150 プロトバハムート', en: monster }, hp: String(hp), hpmax }] },
      twitter: { raid_id: raidId, battle_id: battleId, monster },
      multi_raid_member_info: members.map(([userId, nickname]) => ({ user_id: userId, nickname, is_host: false })),
    }),
  };
}

test('parseRaidStart reads the boss, battle ID and members of the raid just entered', () => {
  /**
   * Given a start.json capture for raid 47030438006 (battle ID 5EF11133, Lvl 150 Proto Bahamut at 539429351 of 1200000000 HP)
   * with members Ake and D.F,
   * When parseRaidStart is called on it at time 1792267800 (seconds),
   * Then it returns the raid id, battle ID, boss name, hp, hpmax, a userId → nickname map, the players in join order
   * and that time as enteredAt, with empty log and lastActionAt.
   */
  const now = 1792267800;
  const raidId = '47030438006';
  const monster = 'Lvl 150 Proto Bahamut';
  const capture = startCapture({ raidId, battleId: '5EF11133', monster, hp: 539429351, hpmax: 1200000000, members: [['26271737', 'Ake'], ['31308953', 'D.F']] });
  assert.deepStrictEqual(parseRaidStart(capture, now), {
    raidId,
    battleId: '5EF11133',
    boss: monster,
    hp: 539429351,
    hpmax: 1200000000,
    members: { 26271737: 'Ake', 31308953: 'D.F' },
    players: ['26271737', '31308953'],
    log: [],
    lastActionAt: {},
    enteredAt: now,
  });
});

test('parseRaidStart returns null for a body that is not JSON', () => {
  /**
   * Given a start.json capture whose body is an HTML error page,
   * When parseRaidStart is called on it,
   * Then it returns null instead of throwing.
   */
  assert.strictEqual(parseRaidStart({ url: 'https://game.granbluefantasy.jp/rest/multiraid/start.json', responseBody: '<html>maintenance</html>' }), null);
});

function emptyRaid() {
  return { raidId: '47030438006', battleId: '5EF11133', boss: 'Lvl 150 Proto Bahamut', hp: 539429351, hpmax: 1200000000, members: {}, players: [], log: [], lastActionAt: {}, honors: {}, enteredAt: 0 };
}

test('mergeRaidStart keeps the log of the same raid after a page reload', () => {
  /**
   * Given a stored raid with one log line,
   * and a new start.json for the same raid id (the page was reloaded) with the boss now at 400000000 HP and a new member,
   * When mergeRaidStart is called,
   * Then the log is kept, and hp and members come from the new start.
   */
  const stored = { ...emptyRaid(), log: [{ time: 105, userId: '2', text: 'action' }] };
  const restarted = { ...emptyRaid(), hp: 400000000, members: { 2: 'D.F', 3: 'new' } };
  assert.deepStrictEqual(mergeRaidStart(stored, restarted), { ...restarted, log: stored.log });
});

test('mergeRaidStart starts fresh when a different raid is entered', () => {
  /**
   * Given a stored raid 47030438006 with one log line,
   * and a start.json for another raid 47030412921,
   * When mergeRaidStart is called,
   * Then it returns the new raid as is, with an empty log.
   */
  const stored = { ...emptyRaid(), log: [{ time: 105, userId: '2', text: 'action' }] };
  const other = { ...emptyRaid(), raidId: '47030412921' };
  assert.deepStrictEqual(mergeRaidStart(stored, other), other);
});

test('mergeRaidStart starts fresh when no raid is stored yet', () => {
  /**
   * Given no stored raid (first raid since storage was empty),
   * When mergeRaidStart is called with a started raid,
   * Then it returns the started raid as is.
   */
  const started = emptyRaid();
  assert.deepStrictEqual(mergeRaidStart(undefined, started), started);
});

test('mergeRaidStart keeps the players order after a page reload', () => {
  /**
   * Given a stored raid whose players are ['3', '1'] (1 seen joining later),
   * and a new start.json for the same raid listing players ['1', '2', '3'],
   * When mergeRaidStart is called,
   * Then players is ['3', '1', '2']: the stored order, then the newcomer.
   */
  const stored = { ...emptyRaid(), players: ['3', '1'] };
  const restarted = { ...emptyRaid(), players: ['1', '2', '3'] };
  assert.deepStrictEqual(mergeRaidStart(stored, restarted).players, ['3', '1', '2']);
});

test('mergeRaidStart keeps the entry time and last actions after a page reload', () => {
  /**
   * Given a stored raid entered at time 100 where player 2 last acted at time 150,
   * and a new start.json for the same raid parsed at time 200 (the page was reloaded),
   * When mergeRaidStart is called,
   * Then enteredAt stays 100 and lastActionAt stays { 2: 150 }.
   */
  const stored = { ...emptyRaid(), enteredAt: 100, lastActionAt: { 2: 150 } };
  const restarted = { ...emptyRaid(), enteredAt: 200 };
  const merged = mergeRaidStart(stored, restarted);
  assert.deepStrictEqual([merged.enteredAt, merged.lastActionAt], [100, { 2: 150 }]);
});

test('parseRaidStart returns null for a JSON body that is not a raid', () => {
  /**
   * Given a start.json capture whose body is the JSON literal null (seen in the extension's error log),
   * When parseRaidStart is called on it,
   * Then it returns null instead of throwing.
   */
  assert.strictEqual(parseRaidStart({ url: 'https://game.granbluefantasy.jp/rest/multiraid/start.json', responseBody: 'null' }, 0), null);
});

// Same shape as a real /rest/multiraid/multi_battle_log response; the game prefixes each line with the JST time.
function battleLogCapture(entries) {
  return {
    url: 'https://game.granbluefantasy.jp/rest/multiraid/multi_battle_log?_=1',
    requestBody: '{"special_token":null,"raid_id":47030438006}',
    responseBody: JSON.stringify({ multi_battle_log: entries.map(([userId, type, en]) => ({ user_id: userId, comment: { ja: '', en }, type: String(type) })) }),
  };
}

test('parseBattleLog turns each battle log entry into a log line at the start of its JST minute', () => {
  /**
   * Given a battle log fetched at 05:10:10 JST (1792267810) with "[05:10] D.F's party attacked! 92916848 damage!" (type "1"),
   * When parseBattleLog is called on it,
   * Then it returns one line at 05:10:00 JST (1792267800), with D.F's user id, type 1, the text with grouped digits
   * and approximate set, since the game only gives the minute.
   */
  const userId = '31308953';
  const capture = battleLogCapture([[userId, 1, '[05:10] D.F\'s party attacked!<br><span class="red">92916848 damage!</span>']]);
  assert.deepStrictEqual(parseBattleLog(capture, 1792267810), [
    { time: 1792267800, userId, type: 1, text: 'D.F\'s party attacked! 92,916,848 damage!', approximate: true },
  ]);
});

test('parseBattleLog puts a line from before midnight JST on the previous day', () => {
  /**
   * Given a battle log fetched at 00:00:30 JST (1792249230) holding a "[23:59]" line,
   * When parseBattleLog is called on it,
   * Then the line is at 23:59 JST the day before (1792249140), not 24 hours in the future.
   */
  const capture = battleLogCapture([['2', 4, '[23:59] D.F\'s party used Genesis Nova!']]);
  assert.strictEqual(parseBattleLog(capture, 1792249230)[0].time, 1792249140);
});

test('parseBattleLog returns no lines for a body it cannot read', () => {
  /**
   * Given battle log captures whose body is an HTML error page, the JSON literal null, and an object without multi_battle_log,
   * When parseBattleLog is called on each,
   * Then each returns an empty list instead of throwing.
   */
  for (const responseBody of ['<html>maintenance</html>', 'null', '{"popup":{}}']) {
    assert.deepStrictEqual(parseBattleLog({ ...battleLogCapture([]), responseBody }, 1792267810), [], responseBody);
  }
});

test('parseBattleLog skips an entry without a time prefix', () => {
  /**
   * Given a battle log with an entry lacking the "[HH:MM]" prefix, then a normal "[05:10]" entry,
   * When parseBattleLog is called on it,
   * Then only the normal entry is returned.
   */
  const capture = battleLogCapture([['2', 4, 'D.F\'s party used Genesis Nova!'], ['2', 4, '[05:10] D.F\'s party attacked!']]);
  assert.deepStrictEqual(parseBattleLog(capture, 1792267810).map(line => line.text), ['D.F\'s party attacked!']);
});

test('backfillRaidLog adds the battle log lines the raid log lacks, without duplicates', () => {
  /**
   * Given a raid log holding D.F's attack at 05:10:06 JST (1792267806),
   * and battle log lines for that same attack at [05:10] plus a counter at [05:09] from before entering,
   * When backfillRaidLog is called,
   * Then only the counter is added, so the attack appears once.
   */
  const attack = { time: 1792267806, userId: '2', type: 1, text: 'D.F\'s party attacked! 92,916,848 damage!' };
  const counter = { time: 1792267740, userId: '3', type: 8, text: '有頂天猫 countered with Counter! 1,652,621 damage!', approximate: true };
  const battleLog = [{ ...attack, time: 1792267800, approximate: true }, counter];
  assert.deepStrictEqual(backfillRaidLog({ ...emptyRaid(), log: [attack] }, battleLog).log, [counter, attack]);
});

test('backfillRaidLog adds only the extra copies of identical lines in the same minute', () => {
  /**
   * Given a raid log with one "Genesis Nova! 999,999 damage!" from D.F at 05:10:06 JST,
   * and a battle log with that same line twice at [05:10] (capped damage repeats exactly),
   * When backfillRaidLog is called,
   * Then the log holds the line twice, not once and not three times.
   */
  const text = 'D.F\'s party used Genesis Nova! 999,999 damage!';
  const seen = { time: 1792267806, userId: '2', type: 4, text };
  const fromBattleLog = { ...seen, time: 1792267800, approximate: true };
  assert.strictEqual(backfillRaidLog({ ...emptyRaid(), log: [seen] }, [fromBattleLog, fromBattleLog]).log.length, 2);
});

test('backfillRaidLog adds players from the added lines but leaves last actions to the honors', () => {
  /**
   * Given a raid where player 2 last acted at 1792267806 and player 3 is unknown,
   * and battle log lines: player 3's counter at 1792267740, player 2's skill at 1792267800 (an earlier minute start),
   * and player 4 joining (type 9) at 1792267740,
   * When backfillRaidLog is called,
   * Then lastActionAt stays { 2: 1792267806 } and players gains 3 then 4.
   */
  const raid = { ...emptyRaid(), players: ['2'], lastActionAt: { 2: 1792267806 } };
  const lines = [
    { time: 1792267740, userId: '3', type: 8, text: 'counter', approximate: true },
    { time: 1792267800, userId: '2', type: 4, text: 'older skill', approximate: true },
    { time: 1792267740, userId: '4', type: 9, text: 'joined!', approximate: true },
  ];
  const filled = backfillRaidLog(raid, lines);
  assert.deepStrictEqual([filled.lastActionAt, filled.players], [{ 2: 1792267806 }, ['2', '3', '4']]);
});

test('backfillRaidLog keeps the log within the limit, dropping the oldest lines', () => {
  /**
   * Given a full raid log (RAID_LOG_LIMIT lines at times 1000 and up) and one battle log line older than all of them,
   * When backfillRaidLog is called,
   * Then the log still holds RAID_LOG_LIMIT lines and the old line is the one dropped.
   */
  const full = Array.from({ length: RAID_LOG_LIMIT }, (_, index) => ({ time: 1000 + index * 60, userId: '2', type: 4, text: `line ${index}` }));
  const old = { time: 0, userId: '2', type: 4, text: 'old', approximate: true };
  const log = backfillRaidLog({ ...emptyRaid(), log: full }, [old]).log;
  assert.deepStrictEqual([log.length, log[0].text], [RAID_LOG_LIMIT, 'line 0']);
});


test('applyPageState takes each player\'s honors from the page, string or number', () => {
  /**
   * Given the game page's state for the current raid, where たろっぺ has 3370444 honors, まの "2230355" (a string)
   * and a newcomer has no point yet (null),
   * When applyPageState is called with it,
   * Then honors maps each user id to a number, leaving out the player with no point.
   */
  const raid = emptyRaid();
  const page = { raidId: raid.raidId, hp: 442551141, points: [['1', 3370444], ['2', '2230355'], ['3', null]] };
  assert.deepStrictEqual(applyPageState(raid, page).honors, { 1: 3370444, 2: 2230355 });
});

test('applyPageState takes the boss HP from the page', () => {
  /**
   * Given a raid stored with the boss at 539429351 HP, and the page now showing "442551141",
   * When applyPageState is called with it,
   * Then hp is the number 442551141.
   */
  const hp = 442551141;
  const raid = emptyRaid();
  assert.strictEqual(applyPageState(raid, { raidId: raid.raidId, hp: String(hp), points: [] }).hp, hp);
});

test('mergeRaidStart keeps the honors after a page reload', () => {
  /**
   * Given a stored raid where player 2 has 3370444 honors,
   * and a new start.json for the same raid (the page was reloaded), which holds no honors,
   * When mergeRaidStart is called,
   * Then honors stay { 2: 3370444 }.
   */
  const honors = { 2: 3370444 };
  const merged = mergeRaidStart({ ...emptyRaid(), honors }, emptyRaid());
  assert.deepStrictEqual(merged.honors, honors);
});

test('applyPageState keeps stored honors the reloaded page has not caught up with', () => {
  /**
   * Given a stored raid where player 1 has 3370444 honors and player 2 has 285877,
   * and the page just after a reload, before the game's first MVP update: player 1 null, player 2 0,
   * When applyPageState is called with it,
   * Then honors stay { 1: 3370444, 2: 285877 }, since honors never go down during a raid.
   */
  const honors = { 1: 3370444, 2: 285877 };
  const raid = { ...emptyRaid(), honors };
  const page = { raidId: raid.raidId, hp: raid.hp, points: [['1', null], ['2', 0]] };
  assert.deepStrictEqual(applyPageState(raid, page).honors, honors);
});

test('applyPageState sets a player\'s last action to now when their honors go up', () => {
  /**
   * Given a stored raid where player 1 has 1000 honors and player 2 has 500, both last acting at 100,
   * and the page now showing player 1 at 1500 and player 2 still at 500,
   * When applyPageState is called at 200,
   * Then lastActionAt is { 1: 200, 2: 100 }.
   */
  const raid = { ...emptyRaid(), honors: { 1: 1000, 2: 500 }, lastActionAt: { 1: 100, 2: 100 } };
  const page = { raidId: raid.raidId, hp: raid.hp, points: [['1', 1500], ['2', 500]] };
  assert.deepStrictEqual(applyPageState(raid, page, 200).lastActionAt, { 1: 200, 2: 100 });
});

test('applyPageState sets no last action for a player first seen with honors', () => {
  /**
   * Given a stored raid with no honors yet (DevTools was opened mid-raid), and the page showing player 1 at 1500,
   * When applyPageState is called at 200,
   * Then lastActionAt stays empty, since those honors may come from before.
   */
  const raid = emptyRaid();
  const page = { raidId: raid.raidId, hp: raid.hp, points: [['1', 1500]] };
  assert.deepStrictEqual(applyPageState(raid, page, 200).lastActionAt, {});
});

test('applyPageState adds the name of a player who joined after the raid started', () => {
  /**
   * Given a stored raid whose members are { 1: 'Alice' },
   * and the page now also listing player 2, 'Bob', who just joined,
   * When applyPageState is called with it,
   * Then members are { 1: 'Alice', 2: 'Bob' }.
   */
  const raid = { ...emptyRaid(), members: { 1: 'Alice' } };
  const page = { raidId: raid.raidId, hp: raid.hp, points: [], members: { 1: 'Alice', 2: 'Bob' } };
  assert.deepStrictEqual(applyPageState(raid, page).members, { 1: 'Alice', 2: 'Bob' });
});

test('applyPageState clears leftAt once the raid page is back', () => {
  /**
   * Given a stored raid that was left at 300,
   * When applyPageState is called with the raid's page state again,
   * Then the raid no longer has a leftAt.
   */
  const raid = { ...emptyRaid(), leftAt: 300 };
  const page = { raidId: raid.raidId, hp: raid.hp, points: [] };
  assert.strictEqual(applyPageState(raid, page, 400).leftAt, undefined);
});

test('parseRaidStart reads a numeric user_id as a string, like the battle log\'s', () => {
  /**
   * Given a start.json capture where one member's user_id is the number 6382168,
   * When parseRaidStart is called,
   * Then players is ["6382168"], so the battle log's "6382168" doesn't add the same player again.
   */
  const capture = startCapture({ raidId: '1', battleId: 'A', monster: 'Boss', hp: 1, hpmax: 1, members: [[6382168, 'ちくわ']] });
  assert.deepStrictEqual(parseRaidStart(capture, 0).players, ['6382168']);
});
