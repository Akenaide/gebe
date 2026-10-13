// Hardcoded rather than read from the response's own `sort` map, which isn't trusted as the source of truth.
const ATTRIBUTE_NAMES = { 1: 'Fire', 2: 'Water', 3: 'Earth', 4: 'Wind', 5: 'Light', 6: 'Dark' };

export function countCrateDuplicates(crate, itemKindId) {
  const counts = new Map();
  for (const item of Object.values(crate)) {
    if (item.item_kind_id !== itemKindId) continue;
    const key = item.regular_id;
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, {
        regular_id: key,
        item_name: item.item_name,
        attribute_name: ATTRIBUTE_NAMES[item.attribute] ?? null,
        count: 1,
      });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

// Uncapped copies stay listed one by one: most uncap stars come from resource items, not fed duplicates, so a summed total misleads.
export function countInventoryDuplicates(owned) {
  const groups = new Map();
  for (const [copyId, { master_id, evolution }] of Object.entries(owned)) {
    if (!groups.has(master_id)) groups.set(master_id, { master_id, zeroStarCount: 0, nonZeroStars: [] });
    const group = groups.get(master_id);
    if (evolution === 0) {
      group.zeroStarCount += 1;
    } else {
      group.nonZeroStars.push({ param_id: Number(copyId), evolution });
    }
  }
  return [...groups.values()];
}

// Keeps every summon, not only per-source duplicates: 2 in the crate + 1 owned is still a duplicate.
export function combineDuplicateSections(crateDupes, inventoryDupes) {
  const rows = new Map();
  for (const c of crateDupes) {
    rows.set(c.regular_id, {
      id: c.regular_id,
      item_name: c.item_name,
      attribute_name: c.attribute_name ?? null,
      crateCount: c.count,
      zeroStarCount: 0,
      nonZeroStars: [],
    });
  }
  for (const inv of inventoryDupes) {
    const existing = rows.get(inv.master_id);
    if (existing) {
      existing.zeroStarCount = inv.zeroStarCount;
      existing.nonZeroStars = inv.nonZeroStars;
    } else {
      rows.set(inv.master_id, {
        id: inv.master_id,
        item_name: null,
        attribute_name: null,
        crateCount: 0,
        zeroStarCount: inv.zeroStarCount,
        nonZeroStars: inv.nonZeroStars,
      });
    }
  }
  return [...rows.values()].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

function sortKey(row) {
  return row.item_name ?? String(row.id);
}

const OWNED_KEYS = { '/summon/list/': 'ownedSummons', '/weapon/list/': 'ownedWeapons' };

export function extractItems(capture) {
  const ownedKey = Object.entries(OWNED_KEYS).find(([urlPattern]) => capture.url.includes(urlPattern))?.[1];
  if (!ownedKey && !capture.url.includes('/present/list/')) return {};
  let list;
  try {
    list = JSON.parse(capture.responseBody)?.list ?? [];
  } catch {
    return {};
  }
  if (ownedKey) {
    const owned = {};
    for (const item of list) {
      if (item.master.rarity !== '4') continue;
      // param.id is the owned copy; master.id shares the crate's regular_id id space, which is what lets the two merge.
      owned[item.param.id] = { master_id: item.master.id, evolution: Number(item.param.evolution) || 0 };
    }
    return { [ownedKey]: owned };
  }
  const crate = {};
  for (const item of list) {
    if (item.rarity !== '4') continue;
    const { item_kind_id, regular_id, item_name, attribute } = item;
    crate[item.id] = { item_kind_id, regular_id, item_name, attribute };
  }
  return { crate };
}
