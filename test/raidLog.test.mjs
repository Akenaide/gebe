import test from 'node:test';
import assert from 'node:assert';
import { parseRaidStart, applyRaidFrames, mergeRaidStart, raidSocketMessages, RAID_LOG_LIMIT, parseBattleLog, backfillRaidLog, leavesRaid, raidSocketQuiet } from '../src/raidLog.js';

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
   * and that time as enteredAt, with empty mvp, log and lastActionAt.
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
    mvp: [],
    log: [],
    lastActionAt: {},
    enteredAt: now,
    lastFrameTime: 0,
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

// A received socket.io frame as DevTools keeps it in a HAR entry's _webSocketMessages.
function raidFrame(time, payload) {
  return { type: 'receive', time, opcode: 1, data: `42${JSON.stringify(['raid', payload])}` };
}

function logEntry(userId, en) {
  return { user_id: userId, comment: { ja: '', en }, type: 4 };
}

function emptyRaid() {
  return { raidId: '47030438006', battleId: '5EF11133', boss: 'Lvl 150 Proto Bahamut', hp: 539429351, hpmax: 1200000000, members: {}, players: [], mvp: [], log: [], lastActionAt: {}, enteredAt: 0, lastFrameTime: 0 };
}

test('applyRaidFrames appends each logAdd action as a plain-text log line', () => {
  /**
   * Given a raid with an empty log and a frame at time 100 whose logAdd holds D.F's attack (HTML-formatted, as the game sends it),
   * When applyRaidFrames is called with that frame,
   * Then the log gets one line with the time, D.F's user id and the text without tags.
   */
  const userId = '31308953';
  const frame = raidFrame(100, { logAdd: { log: [logEntry(userId, ' D.F\'s party attacked!<br><span class="red">92916848 damage!</span>')] } });
  assert.deepStrictEqual(applyRaidFrames(emptyRaid(), [frame]).log, [{ time: 100, userId, type: 4, text: 'D.F\'s party attacked! 92,916,848 damage!' }]);
});

test('applyRaidFrames takes the boss HP from the latest bossUpdate, string or number', () => {
  /**
   * Given a frame at time 100 with boss1_hp "151826375" (a string) then one at time 101 with boss1_hp 61462057 (a number),
   * When applyRaidFrames is called with both,
   * Then hp is the number 61462057.
   */
  const hp = 61462057;
  const frames = [raidFrame(100, { bossUpdate: { param: { boss1_hp: '151826375' } } }), raidFrame(101, { bossUpdate: { param: { boss1_hp: hp } } })];
  assert.strictEqual(applyRaidFrames(emptyRaid(), frames).hp, hp);
});

test('applyRaidFrames replaces the MVP ranking with the latest mvpUpdate', () => {
  /**
   * Given a frame whose mvpUpdate ranks user 23326396 first with "5945644" points and user 26271737 second with "1747608",
   * When applyRaidFrames is called with it,
   * Then mvp lists both with userId, numeric points and rank, in rank order.
   */
  const frame = raidFrame(100, { mvpUpdate: { mvpList: [
    { viewer_id: '153919006', user_id: '23326396', point: '5945644', rank: 1 },
    { viewer_id: '157738240', user_id: '26271737', point: '1747608', rank: 2 },
  ] } });
  assert.deepStrictEqual(applyRaidFrames(emptyRaid(), [frame]).mvp, [
    { userId: '23326396', points: 5945644, rank: 1 },
    { userId: '26271737', points: 1747608, rank: 2 },
  ]);
});

test('applyRaidFrames skips frames it has already applied', () => {
  /**
   * Given a raid whose last applied frame was at time 100, and a poll returning that frame again plus a new one at time 101,
   * When applyRaidFrames is called with both,
   * Then only the time-101 action is appended and lastFrameTime becomes 101.
   */
  const seen = raidFrame(100, { logAdd: { log: [logEntry('1', 'old')] } });
  const fresh = raidFrame(101, { logAdd: { log: [logEntry('2', 'new')] } });
  const raid = applyRaidFrames({ ...emptyRaid(), lastFrameTime: 100 }, [seen, fresh]);
  assert.deepStrictEqual([raid.log.map(line => line.text), raid.lastFrameTime], [['new'], 101]);
});

test('applyRaidFrames ignores pings, sent frames and other events', () => {
  /**
   * Given the non-raid frames seen on a real raid socket (sent "2probe" and "2", received "3probe" and "3",
   * a "chat" event) followed by a raid frame with one action,
   * When applyRaidFrames is called with them,
   * Then only that action is logged.
   */
  const frames = [
    { type: 'send', time: 100, opcode: 1, data: '2probe' },
    { type: 'receive', time: 101, opcode: 1, data: '3probe' },
    { type: 'send', time: 102, opcode: 1, data: '2' },
    { type: 'receive', time: 103, opcode: 1, data: '3' },
    { type: 'receive', time: 104, opcode: 1, data: '42["chat",{"logAdd":{"log":[]}}]' },
    raidFrame(105, { logAdd: { log: [logEntry('2', 'action')] } }),
  ];
  assert.deepStrictEqual(applyRaidFrames(emptyRaid(), frames).log.map(line => line.text), ['action']);
});

test('mergeRaidStart keeps the log of the same raid after a page reload', () => {
  /**
   * Given a stored raid with one log line, an MVP ranking and lastFrameTime 105,
   * and a new start.json for the same raid id (the page was reloaded) with the boss now at 400000000 HP and a new member,
   * When mergeRaidStart is called,
   * Then the log, mvp and lastFrameTime are kept, and hp and members come from the new start.
   */
  const stored = { ...emptyRaid(), mvp: [{ userId: '2', points: 10, rank: 1 }], log: [{ time: 105, userId: '2', text: 'action' }], lastFrameTime: 105 };
  const restarted = { ...emptyRaid(), hp: 400000000, members: { 2: 'D.F', 3: 'new' } };
  assert.deepStrictEqual(mergeRaidStart(stored, restarted), { ...restarted, mvp: stored.mvp, log: stored.log, lastFrameTime: 105 });
});

test('mergeRaidStart starts fresh when a different raid is entered', () => {
  /**
   * Given a stored raid 47030438006 with one log line,
   * and a start.json for another raid 47030412921,
   * When mergeRaidStart is called,
   * Then it returns the new raid as is, with an empty log.
   */
  const stored = { ...emptyRaid(), log: [{ time: 105, userId: '2', text: 'action' }], lastFrameTime: 105 };
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

test('raidSocketMessages collects the frames of the raid socket only', () => {
  /**
   * Given HAR entries for an HTTP request, the guild chat socket, another raid's socket,
   * and two sockets of raid 47030438006 (before and after a page reload, kept by "Preserve log"),
   * When raidSocketMessages is called for raid 47030438006,
   * Then it returns the frames of both sockets of that raid, in time order.
   */
  const socket = (room, times) => ({
    request: { url: `wss://ws.game.granbluefantasy.jp:11240/socket.io/?room=${room}&nickname=Ake&EIO=3&transport=websocket` },
    _webSocketMessages: times.map(time => ({ type: 'receive', time, opcode: 1, data: '3' })),
  });
  const entries = [
    { request: { url: 'https://game.granbluefantasy.jp/rest/multiraid/start.json' } },
    socket('guild815641', [1]),
    socket('raid47030412921', [2]),
    socket('raid47030438006', [4, 3]),
    socket('raid47030438006', [6, 5]),
  ];
  assert.deepStrictEqual(raidSocketMessages(entries, '47030438006').map(message => message.time), [3, 4, 5, 6]);
});

test('applyRaidFrames skips a frame it cannot read and moves past it', () => {
  /**
   * Given a truncated "42[" frame at time 100, a bossUpdate without param at time 101, then a valid action at time 102,
   * When applyRaidFrames is called with them,
   * Then it doesn't throw, logs only the valid action, and lastFrameTime is 102 so the bad frames aren't retried.
   */
  const frames = [
    { type: 'receive', time: 100, opcode: 1, data: '42["raid",{"bossUp' },
    raidFrame(101, { bossUpdate: {} }),
    raidFrame(102, { logAdd: { log: [logEntry('2', 'action')] } }),
  ];
  const raid = applyRaidFrames(emptyRaid(), frames);
  assert.deepStrictEqual([raid.log.map(line => line.text), raid.lastFrameTime], [['action'], 102]);
});

test('applyRaidFrames keeps only the newest log lines past the limit', () => {
  /**
   * Given a raid whose log is already full (RAID_LOG_LIMIT lines, the oldest being "line 0"),
   * When applyRaidFrames adds one new action,
   * Then the log still holds RAID_LOG_LIMIT lines, "line 0" is gone and the new action is last.
   */
  const full = Array.from({ length: RAID_LOG_LIMIT }, (_, index) => ({ time: index, userId: '2', text: `line ${index}` }));
  const raid = applyRaidFrames({ ...emptyRaid(), log: full, lastFrameTime: RAID_LOG_LIMIT }, [raidFrame(RAID_LOG_LIMIT + 1, { logAdd: { log: [logEntry('2', 'new')] } })]);
  assert.deepStrictEqual([raid.log.length, raid.log[0].text, raid.log.at(-1).text], [RAID_LOG_LIMIT, 'line 1', 'new']);
});

test('applyRaidFrames groups the digits of large numbers in log lines', () => {
  /**
   * Given an action "Lvl 150 Proto Bahamut ... 92916848 damage! Charge Bar +48%" in a logAdd frame,
   * When applyRaidFrames is called with it,
   * Then 92916848 becomes 92,916,848 while 150 and 48 stay as they are.
   */
  const frame = raidFrame(100, { logAdd: { log: [logEntry('2', 'D.F\'s party attacked Lvl 150 Proto Bahamut!<br><span class="red">92916848 damage!</span> Charge Bar +48%')] } });
  assert.strictEqual(applyRaidFrames(emptyRaid(), [frame]).log[0].text, 'D.F\'s party attacked Lvl 150 Proto Bahamut! 92,916,848 damage! Charge Bar +48%');
});

test('applyRaidFrames appends players who joined after the start, in order of appearance', () => {
  /**
   * Given a raid whose players are ['26271737'], and a frame where an mvpUpdate lists 26271737 and newcomer 35597399
   * and a logAdd shows another newcomer 31308953,
   * When applyRaidFrames is called with it,
   * Then players becomes ['26271737', '35597399', '31308953'], with no duplicate.
   */
  const frame = raidFrame(100, {
    mvpUpdate: { mvpList: [{ user_id: '26271737', point: '2', rank: 1 }, { user_id: '35597399', point: '1', rank: 2 }] },
    logAdd: { log: [logEntry('31308953', 'action')] },
  });
  assert.deepStrictEqual(applyRaidFrames({ ...emptyRaid(), players: ['26271737'] }, [frame]).players, ['26271737', '35597399', '31308953']);
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

test('applyRaidFrames keeps the game type of each action', () => {
  /**
   * Given a logAdd frame with a normal attack (type 1) and a charge attack (type 2),
   * When applyRaidFrames is called with it,
   * Then each log line carries its type as a number.
   */
  const frame = raidFrame(100, { logAdd: { log: [{ ...logEntry('2', 'attacked!'), type: 1 }, { ...logEntry('2', 'used Eklu Kurnugia +!'), type: '2' }] } });
  assert.deepStrictEqual(applyRaidFrames(emptyRaid(), [frame]).log.map(line => line.type), [1, 2]);
});

test('applyRaidFrames records when each player last acted, ignoring joins and boss events', () => {
  /**
   * Given a frame at time 100 where player 2 uses a skill (type 4) and player 3 joins (type 9),
   * then a frame at time 101 where player 2 triggers the boss's overdrive (type 12),
   * When applyRaidFrames is called with both,
   * Then lastActionAt holds only player 2, at time 100.
   */
  const frames = [
    raidFrame(100, { logAdd: { log: [logEntry('2', 'used a skill'), { ...logEntry('3', 'joined!'), type: 9 }] } }),
    raidFrame(101, { logAdd: { log: [{ ...logEntry('2', 'went into overdrive!'), type: 12 }] } }),
  ];
  assert.deepStrictEqual(applyRaidFrames(emptyRaid(), frames).lastActionAt, { 2: 100 });
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
   * Then it returns one line at 05:10:00 JST (1792267800), with D.F's user id, type 1, the text formatted like socket lines
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

test('backfillRaidLog adds the battle log lines the socket log lacks, without duplicates', () => {
  /**
   * Given a raid log holding D.F's attack seen on the socket at 05:10:06 JST (1792267806),
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

test('backfillRaidLog updates last actions and players from the added lines', () => {
  /**
   * Given a raid where player 2 last acted at 1792267806 (socket) and player 3 is unknown,
   * and battle log lines: player 3's counter at 1792267740, player 2's skill at 1792267800 (an earlier minute start),
   * and player 4 joining (type 9) at 1792267740,
   * When backfillRaidLog is called,
   * Then lastActionAt is { 2: 1792267806, 3: 1792267740 } and players gains 3 then 4.
   */
  const raid = { ...emptyRaid(), players: ['2'], lastActionAt: { 2: 1792267806 } };
  const lines = [
    { time: 1792267740, userId: '3', type: 8, text: 'counter', approximate: true },
    { time: 1792267800, userId: '2', type: 4, text: 'older skill', approximate: true },
    { time: 1792267740, userId: '4', type: 9, text: 'joined!', approximate: true },
  ];
  const filled = backfillRaidLog(raid, lines);
  assert.deepStrictEqual([filled.lastActionAt, filled.players], [{ 2: 1792267806, 3: 1792267740 }, ['2', '3', '4']]);
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

test('leavesRaid is true for any game page but the raid page', () => {
  /**
   * Given the raid page, a raid API call, the result page and a quest page,
   * When leavesRaid is called on each,
   * Then only the result page and the quest page leave the raid.
   */
  const pages = {
    'https://game.granbluefantasy.jp/multiraid/content/index/4114781296?_=1': false,
    'https://game.granbluefantasy.jp/rest/multiraid/start.json?_=1': false,
    'https://game.granbluefantasy.jp/resultmulti/content/index/4114781296?_=1': true,
    'https://game.granbluefantasy.jp/quest/content/supporter_raid/47007998137/2/0?_=1': true,
  };
  for (const [url, leaves] of Object.entries(pages)) assert.strictEqual(leavesRaid(url), leaves, url);
});

test('raidSocketQuiet is true once the raid socket has sent nothing for over 2 minutes', () => {
  /**
   * Given a raid socket whose last frame came at time 1000 (an open socket pings every ~25 s),
   * When raidSocketQuiet is checked 60 s and 121 s later,
   * Then it is quiet only after 121 s.
   */
  const lastFrameTime = 1000;
  assert.deepStrictEqual([raidSocketQuiet(lastFrameTime, lastFrameTime + 60), raidSocketQuiet(lastFrameTime, lastFrameTime + 121)], [false, true]);
});
