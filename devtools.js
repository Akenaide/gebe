import { shouldCapture } from './src/capture.js';
import { parseSupporters, parseFixedSummons, parseFriendList, mergeFriendHistory } from './src/supporters.js';
import { extractItems } from './src/itemStats.js';
import { parseAssistRaids, assistListKey } from './src/assistRaids.js';

let writeQueue = Promise.resolve();
// Friends from the friend list pages seen this session, for the names of the Details pages opened from them.
let listedFriends = {};

// Every storage read-modify-write goes through this one chain, since GBF fires concurrent requests.
function enqueueUpdate(key, update) {
  writeQueue = writeQueue.then(
    () =>
      new Promise(resolve => {
        chrome.storage.local.get(key, data => {
          chrome.storage.local.set({ [key]: update(data[key]) }, resolve);
        });
      })
  );
}

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
    if (capture.url.includes('/friend/friend_list/')) {
      const listed = parseFriendList(capture);
      listedFriends = { ...listedFriends, ...listed };
      // The list is paged, so each page adds to the stored one.
      enqueueUpdate('friendList', friendList => ({ ...friendList, ...listed }));
    }
    if (capture.url.includes('/friend/friend_fixed_summon/')) {
      // shortcut: a Details with no supports set merges nothing, so that friend stays listed as missing; mark it from the URL if it shows up.
      const supporters = parseFixedSummons(capture).map(support => ({ ...support, name: listedFriends[support.userId]?.name }));
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

chrome.devtools.panels.create('Gebe', '', 'panel.html');
