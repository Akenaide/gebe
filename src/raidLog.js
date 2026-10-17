// now is in seconds, like the socket frame times.
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
    mvp: [],
    log: [],
    lastActionAt: {},
    enteredAt: now,
    lastFrameTime: 0,
  };
}

// shortcut: the log is rewritten to storage on each poll, so only the newest lines are kept; raise it if long raids lose lines you need.
export const RAID_LOG_LIMIT = 200;
// Log types that aren't a player acting: 9 joined, 12 boss overdrive, 13 boss break.
const NOT_ACTIONS = new Set([9, 12, 13]);

export function applyRaidFrames(raid, messages) {
  const log = [...raid.log];
  const players = new Set(raid.players);
  // Kept apart from the capped log, so a quiet player's last action isn't lost with old lines.
  const lastActionAt = { ...raid.lastActionAt };
  let { hp, mvp, lastFrameTime } = raid;
  // getHAR() returns every frame of the socket on each poll, so already-applied ones are skipped by time.
  for (const message of messages.filter(message => message.time > raid.lastFrameTime)) {
    lastFrameTime = Math.max(lastFrameTime, message.time);
    // socket.io prefixes an event frame with "42": ["raid", payload]; pings and handshakes are bare digits.
    if (message.type !== 'receive' || !message.data.startsWith('42')) continue;
    // A throw would drop the whole poll, and every later one, since the frame is never moved past; skip what can't be read.
    try {
      const [event, payload] = JSON.parse(message.data.slice(2));
      if (event !== 'raid') continue;
      if (payload.bossUpdate) hp = Number(payload.bossUpdate.param.boss1_hp);
      if (payload.mvpUpdate) mvp = payload.mvpUpdate.mvpList.map(entry => ({ userId: entry.user_id, points: Number(entry.point), rank: entry.rank }));
      for (const entry of payload.mvpUpdate?.mvpList ?? []) players.add(entry.user_id);
      for (const entry of payload.logAdd?.log ?? []) {
        players.add(entry.user_id);
        if (!NOT_ACTIONS.has(Number(entry.type))) lastActionAt[entry.user_id] = message.time;
        log.push({ time: message.time, userId: entry.user_id, type: Number(entry.type), text: logText(entry.comment.en) });
      }
    } catch {
      continue;
    }
  }
  return { ...raid, hp, mvp, players: [...players], lastActionAt, log: log.slice(-RAID_LOG_LIMIT), lastFrameTime };
}

// Players reload the raid page to skip animations, which fetches start.json again for the same raid.
export function mergeRaidStart(stored, started) {
  if (stored?.raidId !== started.raidId) return started;
  const players = [...new Set([...stored.players, ...started.players])];
  const { mvp, log, lastActionAt, enteredAt, lastFrameTime } = stored;
  return { ...started, players, mvp, log, lastActionAt, enteredAt, lastFrameTime };
}

// Each raid has its own socket room; a reload opens a new socket in the same room.
export function raidSocketMessages(entries, raidId) {
  return entries
    .filter(entry => entry._webSocketMessages && new URL(entry.request.url).searchParams.get('room') === `raid${raidId}`)
    .flatMap(entry => entry._webSocketMessages)
    .toSorted((a, b) => a.time - b.time);
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
    // A battle log time is the start of its minute, so it never replaces a later, exact socket time.
    if (!NOT_ACTIONS.has(line.type) && line.time > (lastActionAt[line.userId] ?? 0)) lastActionAt[line.userId] = line.time;
  }
  const log = [...raid.log, ...added].toSorted((a, b) => a.time - b.time).slice(-RAID_LOG_LIMIT);
  return { ...raid, log, players: [...players], lastActionAt };
}

// Every game page loads from /<page>/content/; any but the raid page's own, the result page included, means the raid was left.
export function leavesRaid(url) {
  const page = new URL(url).pathname.match(/^\/([^/]+)\/content\//)?.[1];
  return page !== undefined && page !== 'multiraid';
}

// An open socket.io socket pings about every 25 s, so a socket silent for this long has closed.
const RAID_QUIET_LIMIT = 120;

export function raidSocketQuiet(lastFrameTime, now) {
  return now - lastFrameTime > RAID_QUIET_LIMIT;
}
