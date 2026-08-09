const ATTRIBUTE_NAMES = { 1: 'Fire', 2: 'Water', 3: 'Earth', 4: 'Wind', 5: 'Light', 6: 'Dark' };

export function countCrateDuplicates(entries, itemKindId) {
  const seenIds = new Set();
  const counts = new Map();
  for (const entry of entries) {
    let parsed;
    try {
      parsed = JSON.parse(entry.responseBody);
    } catch {
      continue;
    }
    for (const item of parsed?.list ?? []) {
      if (item.item_kind_id !== itemKindId) continue;
      if (item.rarity !== '4') continue;
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);
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
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

export function countInventoryDuplicates(entries, urlPattern) {
  const seenIds = new Set();
  const groups = new Map();
  for (const entry of entries) {
    if (!entry.url?.includes(urlPattern)) continue;
    let parsed;
    try {
      parsed = JSON.parse(entry.responseBody);
    } catch {
      continue;
    }
    for (const item of parsed?.list ?? []) {
      if (item.master?.rarity !== '4') continue;
      const paramId = item.param?.id;
      if (seenIds.has(paramId)) continue;
      seenIds.add(paramId);
      const key = item.master?.id;
      const evolution = Number(item.param?.evolution) || 0;
      if (!groups.has(key)) groups.set(key, { master_id: key, zeroStarCount: 0, nonZeroStars: [] });
      const group = groups.get(key);
      if (evolution === 0) {
        group.zeroStarCount += 1;
      } else {
        group.nonZeroStars.push({ param_id: paramId, evolution });
      }
    }
  }
  return [...groups.values()];
}

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
