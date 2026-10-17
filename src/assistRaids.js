export function parseAssistRaids(capture) {
  let raids;
  try {
    raids = JSON.parse(capture.responseBody).assist_raids_data ?? [];
  } catch {
    return [];
  }
  return raids.map(raid => ({
    raidId: raid.raid.multi_raid_id,
    questId: raid.raid.quest_id,
    name: raid.chapter_name,
    host: raid.called_user_name,
    hp: raid.boss_hp_width,
    members: raid.member_count,
    limit: raid.assist_user_limit,
    timeLeft: raid.remaining_time,
  }));
}

export function sortByTargetHp(raids, target) {
  return raids.toSorted((a, b) => Math.abs(a.hp - target) - Math.abs(b.hp - target));
}

// The game polls several lists in turn from one backup screen; an empty one has no quest_id, so the key comes from the URL.
export function assistListKey(url) {
  return new URL(url).pathname.match(/assist_list\/(\d+\/\d+)/)[1];
}

export function freshAssistLists(lists, now, maxAge) {
  return Object.fromEntries(Object.entries(lists).filter(([, list]) => now - list.receivedAt <= maxAge));
}
