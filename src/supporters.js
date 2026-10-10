const BLOCK_START = '<div class="btn-supporter lis-supporter"';

// The response is {data: "<URL-encoded HTML>"}; no DOMParser in node tests, so read it with regexes.
export function parseSupporters(capture) {
  let html;
  try {
    html = decodeURIComponent(JSON.parse(capture.responseBody).data);
  } catch {
    return [];
  }
  const supporters = [];
  for (const block of html.split(BLOCK_START).slice(1)) {
    // The last block runs into the page's JS templates, which also mention "ico-friend".
    if (!block.includes('class="prt-supporter-name ico-friend"')) continue;
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
  }
  return supporters;
}

export function mergeFriendHistory(friends, supporters, seenAt) {
  const merged = { ...friends };
  const updated = new Set();
  for (const { userId, name, summonId, summonName, level, slot } of supporters) {
    // A friend has several supports per capture but counts as one sighting.
    if (!updated.has(userId)) {
      updated.add(userId);
      const known = friends[userId];
      merged[userId] = {
        name,
        seenSummons: { ...known?.seenSummons },
        // Records saved before levels were tracked have no bestLevels.
        bestLevels: { ...known?.bestLevels },
        // A capture doesn't always show every slot, so unseen slots keep their last known summon.
        layout: { ...known?.layout },
        sightings: (known?.sightings ?? 0) + 1,
        lastSeen: seenAt,
      };
    }
    merged[userId].seenSummons[summonId] = summonName;
    merged[userId].bestLevels[summonId] = Math.max(merged[userId].bestLevels[summonId] ?? 0, level);
    merged[userId].layout[slot] = { id: summonId, level };
  }
  return merged;
}

export function findMissingSummons(friends, watchedIds, minLevels = {}) {
  const meetsWatch = (friend, id) => id in friend.seenSummons && (friend.bestLevels?.[id] ?? 0) >= (minLevels[id] ?? 0);
  return Object.entries(friends)
    .map(([userId, friend]) => ({ userId, ...friend, missing: watchedIds.filter(id => !meetsWatch(friend, id)) }))
    .filter(friend => friend.missing.length > 0)
    .sort((a, b) => b.sightings - a.sightings);
}

// Element tab codes from the slot's ones digit, listed in the game's tab order.
const TABS = [[1, 'Fire'], [2, 'Water'], [3, 'Earth'], [4, 'Wind'], [5, 'Light'], [6, 'Dark'], [0, 'Misc']];

export function groupLayout(layout) {
  const slots = Object.keys(layout).map(Number).sort((a, b) => a - b);
  return TABS.map(([code, element]) => ({
    element,
    slots: slots.filter(slot => slot % 10 === code).map(slot => layout[slot]),
  }));
}
