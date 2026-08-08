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
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      const key = item.regular_id;
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(key, { regular_id: key, item_name: item.item_name, count: 1 });
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
  return [...groups.values()]
    .filter(g => g.zeroStarCount + g.nonZeroStars.length > 1)
    .sort((a, b) => (b.zeroStarCount + b.nonZeroStars.length) - (a.zeroStarCount + a.nonZeroStars.length));
}
