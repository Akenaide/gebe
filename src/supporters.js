import { ELEMENTS } from './elements.js';

const BLOCK_START = '<div class="btn-supporter lis-supporter"';

// The response is {data: "<URL-encoded HTML>"}; no DOMParser in node tests, so read it with regexes.
// friend: false returns the non-friends' supports instead.
export function parseSupporters(capture, { friend = true } = {}) {
  let html;
  try {
    html = decodeURIComponent(JSON.parse(capture.responseBody).data);
  } catch {
    return [];
  }
  const supporters = [];
  for (const block of html.split(BLOCK_START).slice(1)) {
    // The last block runs into the page's JS templates, which also mention "ico-friend", so only its first name div counts.
    if ((block.match(/class="prt-supporter-name[^"]*"/)?.[0] === 'class="prt-supporter-name ico-friend"') !== friend) continue;
    // A block missing a field throws on its match; skip that support, not the whole page.
    try {
      supporters.push({
        userId: block.match(/data-supporter-user-id="(\d+)"/)[1],
        name: block.match(/<span class="txt-supporter-name">([^<]*)</)[1],
        // Uncapped art is "2040056000_04"; the id before "_" is the summon.
        summonId: block.match(/data-image="(\d+)/)[1],
        summonName: block.match(/<span class="js-summon-name">([^<]*)</)[1],
        level: Number(block.match(/<span class="txt-summon-level">Lvl (\d+)/)[1]),
        // row * 10 + element tab (0 Misc, 1 Fire … 6 Dark), e.g. 15 = Light, second row.
        slot: Number(block.match(/data-attribute="(\d+)"/)[1]),
      });
    } catch {
      continue;
    }
  }
  return supporters;
}

// fromDetails: the friend's Details page, which isn't a sighting.
export function mergeFriendHistory(friends, supporters, seenAt, { fromDetails = false } = {}) {
  const merged = { ...friends };
  const updated = new Set();
  for (const { userId, name, summonId, summonName, level, slot } of supporters) {
    // A friend has several supports per capture but counts as one sighting.
    if (!updated.has(userId)) {
      updated.add(userId);
      const known = friends[userId];
      // Only the current layout is kept: a summon the friend swapped out no longer counts. Records saved
      // with the old seenSummons/bestLevels history drop it here.
      merged[userId] = {
        name: name ?? known?.name,
        // Both a supporter page and Details show every slot, so the capture is the whole layout.
        layout: {},
        sightings: (known?.sightings ?? 0) + (fromDetails ? 0 : 1),
        lastSeen: fromDetails ? known?.lastSeen : seenAt,
      };
    }
    merged[userId].layout[slot] = { id: summonId, name: summonName, level };
  }
  return merged;
}

// A summon in several slots counts once, at its highest level; friends saved before layouts were tracked have none.
export function bestLevels(layout = {}) {
  const best = {};
  for (const { id, level } of Object.values(layout)) best[id] = Math.max(best[id] ?? 0, level);
  return best;
}

export function offersAll(layout, summonIds, minLevels = {}) {
  const offered = bestLevels(layout);
  return summonIds.every(id => id in offered && offered[id] >= (minLevels[id] ?? 0));
}

// From each friend's current layout: a summon they swapped out is missing again.
export function findMissingSummons(friends, watchedIds, minLevels = {}) {
  return Object.entries(friends)
    .map(([userId, friend]) => {
      const best = bestLevels(friend.layout);
      return { userId, ...friend, missing: watchedIds.filter(id => !(id in best && best[id] >= (minLevels[id] ?? 0))) };
    })
    .filter(friend => friend.missing.length > 0)
    .sort((a, b) => b.sightings - a.sightings);
}

// Element tab codes from the slot's ones digit, listed in the game's tab order.
const TABS = [...Object.entries(ELEMENTS).map(([code, element]) => [Number(code), element]), [0, 'Misc']];

export function groupLayout(layout) {
  const slots = Object.keys(layout).map(Number).sort((a, b) => a - b);
  return TABS.map(([code, element]) => ({
    element,
    slots: slots.filter(slot => slot % 10 === code).map(slot => layout[slot]),
  }));
}

// A friend's Details: {fixed_summon_list: [[{fixed_summon_info, fix_status}]]}, one list per element tab.
export function parseFixedSummons(capture) {
  const userId = new URL(capture.url).pathname.split('/').pop();
  let lists;
  try {
    lists = JSON.parse(capture.responseBody).fixed_summon_list ?? [];
  } catch {
    return [];
  }
  return lists.flat()
    .filter(({ fix_status }) => fix_status === 1)
    .map(({ fixed_summon_info: info }) => ({
      userId,
      summonId: info.master_id,
      summonName: info.name,
      level: Number(info.level),
      // Same row * 10 + element tab code as a supporter page's data-attribute.
      slot: info.attribute_key,
    }));
}

// Details has no friend name, so it's taken from the friend list page the player opened it from.
// The page tells the player where to find a friend whose Details is missing.
export function parseFriendList(capture) {
  let list, page;
  try {
    ({ list = [], current: page } = JSON.parse(capture.responseBody));
  } catch {
    return {};
  }
  return Object.fromEntries(list.map(({ id, name }) => [id, { name, page }]));
}

// From each friend's current layout; friends saved before layouts were tracked aren't counted.
export function countSupportStats(friends) {
  const withLayout = Object.entries(friends).filter(([, friend]) => friend.layout && Object.keys(friend.layout).length);
  const stats = {};
  for (const [userId, friend] of withLayout) {
    for (const [id, level] of Object.entries(bestLevels(friend.layout))) {
      stats[id] ??= { id, friendCount: 0, levels: {} };
      stats[id].friendCount++;
      (stats[id].levels[level] ??= []).push(userId);
    }
  }
  return { friendCount: withLayout.length, summons: Object.values(stats).sort((a, b) => b.friendCount - a.friendCount) };
}

// Friends from the friend list pages Gebe has no record of yet, grouped by the page they're on.
export function findMissingDetails(friendList, friends) {
  const pages = {};
  for (const [userId, { name, page }] of Object.entries(friendList)) {
    if (!(userId in friends)) (pages[page] ??= []).push({ userId, name });
  }
  // Integer keys iterate in ascending order, so pages come out sorted.
  return Object.entries(pages).map(([page, missing]) => ({ page: Number(page), friends: missing }));
}
