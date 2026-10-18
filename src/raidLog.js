// now is in seconds, like the battle log line times.
export function parseRaidStart(capture, now) {
  let start;
  try {
    start = JSON.parse(capture.responseBody);
  } catch {
    return null;
  }
  // The game sometimes answers with a bare null, or an error popup instead of the raid.
  if (!start?.boss || !start.twitter) return null;
  // shortcut: only the first boss is read; upgrade if multi-boss raids matter.
  const boss = start.boss.param[0];
  return {
    raidId: start.twitter.raid_id,
    battleId: start.twitter.battle_id,
    // boss.name is sometimes {ja, en}, sometimes a string; twitter.monster is always a string.
    boss: start.twitter.monster,
    hp: Number(boss.hp),
    hpmax: Number(boss.hpmax),
    members: Object.fromEntries(start.multi_raid_member_info.map(member => [member.user_id, member.nickname])),
    // Join order, so each player keeps the same color for the whole raid (object keys would sort numerically).
    players: start.multi_raid_member_info.map(member => member.user_id),
    log: [],
    lastActionAt: {},
    enteredAt: now,
  };
}

// shortcut: the log is rewritten to storage on each battle log open, so only the newest lines are kept; raise it if long raids lose lines you need.
export const RAID_LOG_LIMIT = 200;
// Log types that aren't a player acting: 9 joined, 12 boss overdrive, 13 boss break.
const NOT_ACTIONS = new Set([9, 12, 13]);

// Players reload the raid page to skip animations, which fetches start.json again for the same raid.
export function mergeRaidStart(stored, started) {
  if (stored?.raidId !== started.raidId) return started;
  const players = [...new Set([...stored.players, ...started.players])];
  const { log, lastActionAt, enteredAt, honors } = stored;
  return { ...started, players, log, lastActionAt, enteredAt, honors };
}

function logText(html) {
  const text = html.replace(/<br>/g, ' ').replace(/<[^>]*>/g, '').trim();
  // Damage runs into the tens of millions; grouping digits makes it readable at a glance.
  return text.replace(/\d{4,}/g, digits => Number(digits).toLocaleString('en-US'));
}

// The battle log's "[HH:MM]" is Japan time (UTC+9, no daylight saving).
const JST_OFFSET = 9 * 3600;

// The game's own battle log, fetched when the player opens it; times are in seconds.
export function parseBattleLog(capture, fetchedAt) {
  let entries;
  try {
    entries = JSON.parse(capture.responseBody)?.multi_battle_log ?? [];
  } catch {
    return [];
  }
  const jstDayStart = Math.floor((fetchedAt + JST_OFFSET) / 86400) * 86400 - JST_OFFSET;
  return entries.flatMap(entry => {
    const match = entry.comment?.en?.match(/^\[(\d\d):(\d\d)\] ?([\s\S]*)$/);
    if (!match) return [];
    const [, hours, minutes, html] = match;
    const time = jstDayStart + Number(hours) * 3600 + Number(minutes) * 60;
    return [{
      // The line has no date: a time later than the fetch belongs to the day before.
      time: time > fetchedAt ? time - 86400 : time,
      userId: entry.user_id,
      type: Number(entry.type),
      text: logText(html),
      approximate: true,
    }];
  });
}

// The battle log only gives the minute, and JST is a whole number of hours from UTC, so minutes line up on both sides.
function lineKey(line) {
  return `${line.userId}|${line.type}|${line.text}|${Math.floor(line.time / 60)}`;
}

export function backfillRaidLog(raid, lines) {
  // Counted, not a set: capped damage or "C.A. Bonus Effect!" can repeat exactly within a minute.
  const unmatched = {};
  for (const line of raid.log) unmatched[lineKey(line)] = (unmatched[lineKey(line)] ?? 0) + 1;
  const added = lines.filter(line => {
    if (!unmatched[lineKey(line)]) return true;
    unmatched[lineKey(line)] -= 1;
    return false;
  });
  const players = new Set(raid.players);
  const lastActionAt = { ...raid.lastActionAt };
  for (const line of added) {
    players.add(line.userId);
    // Each open repeats earlier lines, so only a later line moves a player's last action.
    if (!NOT_ACTIONS.has(line.type) && line.time > (lastActionAt[line.userId] ?? 0)) lastActionAt[line.userId] = line.time;
  }
  const log = [...raid.log, ...added].toSorted((a, b) => a.time - b.time).slice(-RAID_LOG_LIMIT);
  return { ...raid, log, players: [...players], lastActionAt };
}

// The game's page state (stage.pJsnData), which it keeps current from the raid socket; read by devtools.js.
export function applyPageState(raid, page) {
  // A player has no point until the game's first MVP update after they join or after a reload;
  // honors never go down during a raid, so the higher of stored and page wins.
  const honors = { ...raid.honors };
  for (const [userId, point] of page.points) {
    if (point != null) honors[userId] = Math.max(honors[userId] ?? 0, Number(point));
  }
  return { ...raid, hp: Number(page.hp), honors };
}
