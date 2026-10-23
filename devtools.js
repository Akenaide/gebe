import { shouldCapture } from './src/capture.js';
import { parseSupporters, parseFixedSummons, parseFriendList, mergeFriendHistory } from './src/supporters.js';
import { extractItems } from './src/itemStats.js';
import { parseAssistRaids, assistListKey } from './src/assistRaids.js';
import * as raidLog from './src/raidLog.js';
import { createWriteQueue } from './src/writeQueue.js';

const { enqueueUpdate } = createWriteQueue(chrome.storage.local);

chrome.devtools.network.onRequestFinished.addListener(request => {
  if (!shouldCapture(request.request.url)) return;
  request.getContent(content => {
    const capture = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      url: request.request.url,
      method: request.request.method,
      status: request.response.status,
      requestBody: request.request.postData?.text ?? null,
      responseBody: content ?? null,
    };
    if (capturing) enqueueUpdate('captures', captures => [...(captures || []), capture]);
    for (const [key, items] of Object.entries(extractItems(capture))) {
      if (Object.keys(items).length) enqueueUpdate(key, stored => ({ ...stored, ...items }));
    }
    if (capture.url.includes('/quest/content/supporter_raid/')) {
      const supporters = parseSupporters(capture);
      if (supporters.length) enqueueUpdate('friends', friends => mergeFriendHistory(friends || {}, supporters, Date.now()));
    }
    if (capture.url.includes('/quest/assist/search/assist_list/')) {
      // The game re-polls each whole list every ~1.4s, so the latest one replaces that list's stored one.
      const list = { raids: parseAssistRaids(capture), receivedAt: Date.now() };
      enqueueUpdate('assistRaids', stored => ({ ...stored, [assistListKey(capture.url)]: list }));
    }
    if (capture.url.includes('/rest/multiraid/start.json')) {
      const started = raidLog.parseRaidStart(capture, Date.now() / 1000);
      if (started) enqueueUpdate('currentRaid', stored => raidLog.mergeRaidStart(stored, started));
    }
    // The game's own battle log, fetched when the player opens it, is the raid log's only source:
    // reading the raid socket meant polling getHAR(), suspected of leaking memory (see the live-raid-log branch).
    if (capture.url.includes('/rest/multiraid/multi_battle_log')) {
      const raidId = capture.requestBody?.match(/"raid_id":"?(\d+)/)?.[1];
      const lines = raidLog.parseBattleLog(capture, Date.now() / 1000);
      if (raidId && lines.length) enqueueUpdate('currentRaid', raid => (raid?.raidId === raidId ? raidLog.backfillRaidLog(raid, lines) : raid));
    }
    if (capture.url.includes('/friend/friend_list/')) {
      const listed = parseFriendList(capture);
      // The list is paged, so each page adds to the stored one.
      enqueueUpdate('friendList', friendList => ({ ...friendList, ...listed }));
    }
    if (capture.url.includes('/friend/friend_fixed_summon/')) {
      // shortcut: a Details with no supports set merges nothing, so that friend stays listed as missing; mark it from the URL if it shows up.
      const supporters = parseFixedSummons(capture);
      if (supporters.length) enqueueUpdate('friends', friends => mergeFriendHistory(friends || {}, supporters, Date.now(), { fromDetails: true }));
    }
  });
});

// Saving every raw capture made each write rewrite an ever-growing list and slowed the game, so it's off by default.
let capturing = false;
chrome.storage.local.set({ capturing });
chrome.storage.onChanged.addListener(changes => {
  if (changes.capturing) capturing = changes.capturing.newValue;
});

// The game keeps honors and boss HP current in its page state, from the raid socket; reading a few fields is far cheaper than getHAR().
const PAGE_STATE = `(() => {
  const raid = window.stage?.pJsnData;
  if (!raid?.twitter || !raid.multi_raid_member_info) return null;
  return { raidId: String(raid.twitter.raid_id), hp: raid.boss.param[0].hp, points: raid.multi_raid_member_info.map(m => [m.user_id, m.point]) };
})()`;
let lastPageState = null;
setInterval(() => {
  chrome.devtools.inspectedWindow.eval(PAGE_STATE, page => {
    // Unchanged (or a stale raid's state after leaving it): nothing to write.
    if (!page || JSON.stringify(page) === lastPageState) return;
    lastPageState = JSON.stringify(page);
    enqueueUpdate('currentRaid', raid => (raid?.raidId === page.raidId ? raidLog.applyPageState(raid, page, Date.now() / 1000) : raid));
  });
}, 1000);

chrome.devtools.panels.create('Gebe', '', 'panel.html');
