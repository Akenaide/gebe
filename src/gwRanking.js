const toNumber = text => Number(text.replace(/[#,]/g, ''));

// The page is HTML in a URL-encoded `data` field; each entry shows its place, then Defeated and Honors spans in that order.
function parseEntry(html) {
  const place = html.match(/ico-rank-digits">([^<]+)</)?.[1];
  const [defeated, honors] = [...html.matchAll(/<span>([\d,]+)<\/span>/g)].map(m => toNumber(m[1]));
  return { place: place && toNumber(place), defeated, honors };
}

export function appendGwSnapshot(stored, { eventId, me, cutoffs }, at) {
  const snapshots = stored?.[eventId] ?? [];
  const last = snapshots.at(-1);
  // Reopening the page before the ranking updates gives the same numbers: no new snapshot, so no zero-speed interval.
  // Compared by value: chrome.storage returns keys in alphabetical order, so a JSON string never matches.
  const progress = s => [s.me.place, s.me.honors, ...Object.entries(s.cutoffs).sort(([a], [b]) => a - b).map(([place, c]) => `${place}:${c.honors}`)].join('|');
  if (last && progress(last) === progress({ me, cutoffs })) return stored;
  return { ...stored, [eventId]: [...snapshots, { at, me, cutoffs }] };
}

const isSnapshot = s => Number.isFinite(s?.at) && Number.isFinite(s.me?.place) && Number.isFinite(s.me.honors) && typeof s.cutoffs === 'object' && s.cutoffs !== null;

// The import is a file the user picks, so anything not shaped like gwRanking is refused before it reaches storage.
export function parseGwExport(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const valid = typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every(s => Array.isArray(s) && s.every(isSnapshot));
  return valid ? value : null;
}

// Snapshots are facts that never change, so a merge is their union in time order, replayed through the duplicate rule.
export function mergeGwRankings(local, imported) {
  let merged = {};
  for (const eventId of new Set([...Object.keys(local ?? {}), ...Object.keys(imported ?? {})])) {
    const snapshots = [...(local?.[eventId] ?? []), ...(imported?.[eventId] ?? [])].sort((a, b) => a.at - b.at);
    for (const { at, me, cutoffs } of snapshots) merged = appendGwSnapshot(merged, { eventId, me, cutoffs }, at);
  }
  return merged;
}

export function windowLength(ms) {
  const minutes = Math.round(ms / 60_000);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`;
}

export function honorsRates(snapshots) {
  return snapshots.slice(1).map((next, i) => {
    const prev = snapshots[i];
    const hours = (next.at - prev.at) / 3600000;
    const rate = (from, to) => (to - from) / hours;
    const cutoffs = {};
    for (const place in next.cutoffs) if (prev.cutoffs[place]) cutoffs[place] = rate(prev.cutoffs[place].honors, next.cutoffs[place].honors);
    return { from: prev.at, to: next.at, place: next.me.place, placeChange: prev.me.place - next.me.place, me: rate(prev.me.honors, next.me.honors), cutoffs };
  }).reverse();
}

export function parseGwRanking(capture) {
  let html;
  try {
    html = decodeURIComponent(JSON.parse(capture.responseBody).data);
  } catch {
    return null;
  }
  if (!html.includes('class="prt-my-ranking"')) return null;
  const [, mine, ...listed] = html.split(/class="(?:prt-my-ranking|lis-ranking)"/);
  const cutoffs = {};
  // The top 3 show a crown instead of digits, so they have no place and aren't cutoffs.
  for (const { place, ...entry } of listed.map(parseEntry)) if (place) cutoffs[place] = entry;
  const eventId = new URL(capture.url).pathname.split('/')[1];
  return { eventId, me: parseEntry(mine), cutoffs };
}
