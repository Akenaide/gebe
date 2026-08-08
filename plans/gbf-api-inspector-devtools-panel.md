# Chrome extension: GBF API capture & dashboard

## Context

Goal: a Chrome extension that watches the Granblue Fantasy web game's REST/XHR traffic (`game.granbluefantasy.jp`) and gives a **live dashboard** of captured request/response pairs plus **JSON export** — confirmed scope from earlier discussion. We already inspected real traffic manually (no automated clicking, per the ban-risk constraint) using DevTools-style network capture, and have two concrete sample responses showing the game's JSON API shapes.

**Two duplicate-tracking use cases matter, and they're deliberately both in scope — not one replacing the other:**
- **Crate duplicates** — `present.json` (`/present/list/{cat}/{sub}/{page}`), the unclaimed-presents crate. Flat items: `{id, item_kind_id, regular_id, item_name, ...}`. A repeat `regular_id` here means you were *sent* the same summon twice as a gift and haven't claimed it yet — useful as an early warning before you even claim.
- **Inventory duplicates** — `inventory-summon.json` (`/summon/list/{page}`), the real owned-summon collection. Its items look completely different: `{param: {id, image_id, level, ...}, master: {id, rarity, ...}}` — no `item_kind_id`, no `regular_id`, no `item_name` at all. `param.id` is the unique owned-instance id; `master.id` is "which summon" (same numeric space as `regular_id`/the CDN image id, e.g. `2040158000`). This sample already contains a real duplicate: **`master.id 2040158000` appears 4 times** (`param.id` 1243639174, 1208254746, 1091463657, 1067755759).

Because the two shapes don't share fields, they need two separate pure aggregation functions — but each is still generic over "which kind of item"/"which endpoint" so Weapons is a new call site later, not new logic: crate duplicates generalize over `item_kind_id` (`'2'` now, `'1'` for weapons later); inventory duplicates generalize over the endpoint URL (`/summon/list/` now, `/weapon/list/` later, assuming — to verify when we get there — the weapon inventory endpoint shares the same `param`/`master` shape).

### Why Manifest V3, and why a DevTools panel (2026 answer to "what type of chrome ext do we have")
Chrome no longer runs Manifest V2 extensions, so this must be **Manifest V3**. Within MV3 there are still several extension "shapes" (popup-only, content-script injector, DevTools extension, side panel, etc.) — the user asked for the one that works "like before," i.e. the same mechanism we just used to inspect traffic manually: **DevTools' own network inspection**, exposed to extensions via `chrome.devtools.network`.

This is a better fit than the originally-planned fetch/XHR monkey-patch:
- `chrome.devtools.network.onRequestFinished` fires for every network request in the inspected tab and gives a HAR-style entry, including `request.postData` (request body) and an async `getContent()` for the **response body** — exactly what the Network tab shows, no page-JS patching required.
- It only works while DevTools is open for that tab (same limitation the Network tab itself has — consistent with "like before").
- No `content_scripts`, no `world: "MAIN"` page injection, no `host_permissions` needed at all — the API operates on the inspected window regardless. Smaller attack surface / fewer permissions requested.
- Dashboard lives as a **new DevTools panel** (tab next to Elements/Console/Network), per your choice, rather than a toolbar popup.

## Architecture

```
chrome.devtools.network.onRequestFinished   (fires while DevTools is open, in devtools.js)
   -> devtools.js         (creates the panel, listens for finished requests, calls request.getContent()
                            for the response body, writes to chrome.storage.local)
   -> panel.html/panel.js (the new DevTools panel tab: reads storage, live-updates via
                            chrome.storage.onChanged, table + JSON viewer + Export + Clear)
```

No service worker, no content scripts, no host permissions — `devtools.js` runs once per DevTools session for that tab and does all the capturing directly.

`chrome.devtools.network.onRequestFinished` fires once per request, and GBF fires several concurrently, so a naive read-all → append → write-all against `chrome.storage.local` on every event can race: two overlapping writes can silently drop a captured request. `devtools.js` serializes all storage writes through a single promise chain (each write waits for the previous one to finish) instead of firing them independently.

Pure, testable logic stays in `src/ringBuffer.js` (no chrome.* / DOM dependency):
- `mergeEntries(existing, imported)` — dedupes by each capture's own `id` before concatenating, so importing an exported file that overlaps with what's already stored doesn't duplicate rows.

Storage isn't artificially capped — the manifest requests the `unlimitedStorage` permission (a native platform feature) instead of hand-rolling a ring-buffer trim, so there's no invented cap logic to maintain.

`chrome.storage.local` is disk-backed and already persists across DevTools close/reopen and browser restarts on its own — that's the baseline cross-session persistence, free, no extra code. Import is the complement: it covers *portability* (moving data to another machine/profile, or restoring after storage gets cleared), which storage.local alone doesn't give you. Doing both: storage.local for the automatic case, Import/Export for the manual-backup case.

Everything else (manifest wiring, devtools API glue, panel rendering) is plumbing around those two functions, verified manually by opening DevTools on the GBF tab and watching the new panel — not worth a browser test framework for (ponytail: no puppeteer/jest, `node:test` + `assert` from stdlib is enough for the pure logic).

## Files to create

- `manifest.json` — MV3, `permissions: ["storage", "unlimitedStorage"]`, `devtools_page: "devtools.html"`. No `content_scripts`, no `host_permissions`.
- `devtools.html` — loads `devtools.js` as a module.
- `devtools.js` — `chrome.devtools.panels.create('API Capture', '', 'panel.html')`; `chrome.devtools.network.onRequestFinished.addListener(entry => ...)`: reads `entry.request.method/url/postData`, calls `entry.getContent((body, encoding) => ...)` for the response, builds a capture object, appends it to `chrome.storage.local`.
- `src/ringBuffer.js` — `mergeEntries` (pure, exported for both the extension and the Node test).
- `src/itemStats.js` — two pure aggregators, kept side by side since they answer different questions from different shapes:
  - `countCrateDuplicates(entries, itemKindId)` — parses each entry's `responseBody` as JSON (skips silently if not valid JSON or has no `list`), filters items with `item_kind_id === itemKindId`, dedupes by each item's own `id` (so a re-fetched present isn't double-counted), groups by `regular_id`, returns `[{regular_id, item_name, count}]` sorted by count desc. `countCrateDuplicates(captures, '2')` for Summons; `countCrateDuplicates(captures, '1')` for Weapons later.
  - `countInventoryDuplicates(entries, urlPattern)` — filters `entries` to those whose `url` includes `urlPattern`, parses `responseBody`, dedupes items by `param.id`, groups by `master.id` into `{master_id, zeroStarCount, nonZeroStars}`: plain 0★ copies are tallied into `zeroStarCount`, while any copy with uncap stars (`param.evolution > 0`) is kept as its own entry in `nonZeroStars` (`[{param_id, evolution}]`) rather than folded into a number — a 0★ copy is a plain spare, a starred one is a judgment call you make yourself by seeing its level. Only reports a `master.id` when total owned copies (`zeroStarCount + nonZeroStars.length`) is `> 1` — one copy alone isn't a duplicate. Sorted by total copies desc. `countInventoryDuplicates(captures, '/summon/list/')` for Summons; `countInventoryDuplicates(captures, '/weapon/list/')` for Weapons later.
- `panel.html`, `panel.js`, `panel.css` — reads `captures` from `chrome.storage.local`, subscribes to `chrome.storage.onChanged` for live updates, renders a table (time/method/url/status), click-to-expand `<pre>` JSON viewer, "Export JSON" (Blob + `<a download>`), "Import JSON" (`<input type="file">` → read → `JSON.parse` → `mergeEntries` with what's in storage → write back), "Clear" (`chrome.storage.local.remove`), plus two generic section-renderer helpers, both building a thumbnail from `https://prd-game-a-granbluefantasy.akamaized.net/assets_en/img_low/sp/assets/${assetFolder}/s/${id}.jpg`:
  - `renderCrateDuplicateSection(title, itemKindId, assetFolder)` — called now as `renderCrateDuplicateSection('Unclaimed Summon Duplicates', '2', 'summon')`.
  - `renderInventoryDuplicateSection(title, urlPattern, assetFolder)` — called now as `renderInventoryDuplicateSection('Summon Inventory Duplicates', '/summon/list/', 'summon')`; each row shows `zeroStarCount` as a plain number (e.g. "×3 at 0★") followed by one sub-item per `nonZeroStars` entry showing its own star level (e.g. "★1", "★3") — no folded total.
  - Weapons later is one more call to each: `renderCrateDuplicateSection('Unclaimed Weapon Duplicates', '1', 'weapon')` and `renderInventoryDuplicateSection('Weapon Inventory Duplicates', '/weapon/list/', 'weapon')`.
- `test/ringBuffer.test.mjs`, `test/itemStats.test.mjs` — `node:test` + `assert`, run via `node --test test/*.test.mjs`.

## TDD cycles

(Unchanged from prior plan — the pure logic doesn't depend on the capture mechanism.)

### Behavior 1 — `mergeEntries` dedupes imported entries by `id`

**Red**
```js
test('mergeEntries concatenates existing and imported entries, deduped by id', () => {
  /**
   * Given an existing entry with id 'a' and an imported list containing that same id 'a'
   * plus a new id 'b',
   * When mergeEntries is called,
   * Then the result has exactly one 'a' (the existing one wins) and one 'b', in that order.
   */
  const existing = [{ id: 'a', url: 'existing' }];
  const imported = [{ id: 'a', url: 'imported-duplicate' }, { id: 'b', url: 'new' }];
  assert.deepStrictEqual(mergeEntries(existing, imported), [
    { id: 'a', url: 'existing' },
    { id: 'b', url: 'new' },
  ]);
});
```
Run `node --test test/ringBuffer.test.mjs` — stub `export function mergeEntries() {}` first so it fails on the assertion, not an import error.

**Green**
```js
export function mergeEntries(existing, imported) {
  const existingIds = new Set(existing.map(e => e.id));
  return [...existing, ...imported.filter(e => !existingIds.has(e.id))];
}
```

**Refactor** — none needed.

`mergeEntries` is wired into the panel's Import flow (no new test needed for that wiring; it's plumbing, verified manually below).

### Behavior 2 — `countCrateDuplicates` groups unclaimed-present items of a given kind by `regular_id` and flags repeats

Generic over `item_kind_id` from the start (`'2'` for Summons now, `'1'` for the upcoming Weapons feature) so Weapons doesn't need a new aggregation function later — just a new call site.

**Red**
```js
test('countCrateDuplicates counts repeated regular_id among entries of the given item_kind_id', () => {
  /**
   * Given a captured entry whose response body list contains two distinct Tetragod summons
   * (regular_id 2040435000, same as the real duplicate seen in present.json, but two different
   * item `id`s since they're two separate physical presents), one Shiva summon, and one weapon
   * (item_kind_id '1') that must be ignored when querying for kind '2',
   * When countCrateDuplicates is called with itemKindId '2',
   * Then Tetragod is reported with count 2 and Shiva with count 1, sorted by count desc, and the
   * weapon does not appear.
   */
  const responseBody = JSON.stringify({
    list: [
      { id: '6891474499', item_kind_id: '2', regular_id: 2040435000, item_name: 'Tetragod' },
      { id: '6903804131', item_kind_id: '2', regular_id: 2040435000, item_name: 'Tetragod' },
      { id: '6919948785', item_kind_id: '2', regular_id: 2040185000, item_name: 'Shiva' },
      { id: '7000000001', item_kind_id: '1', regular_id: 1040000000, item_name: 'Some Weapon' },
    ],
  });
  const result = countCrateDuplicates([{ responseBody }], '2');
  assert.deepStrictEqual(result, [
    { regular_id: 2040435000, item_name: 'Tetragod', count: 2 },
    { regular_id: 2040185000, item_name: 'Shiva', count: 1 },
  ]);
});

test('countCrateDuplicates dedupes by item id so a re-captured item is not counted twice', () => {
  /**
   * Given two separate captures (e.g. the same present-list page fetched twice, such as on
   * a refresh) that both contain the exact same Tetragod item id,
   * When countCrateDuplicates is called across both captures with itemKindId '2',
   * Then Tetragod is reported with count 1, not 2 — the repeat id is deduped, not double-counted.
   */
  const makeBody = () => JSON.stringify({
    list: [{ id: '6891474499', item_kind_id: '2', regular_id: 2040435000, item_name: 'Tetragod' }],
  });
  const result = countCrateDuplicates([{ responseBody: makeBody() }, { responseBody: makeBody() }], '2');
  assert.deepStrictEqual(result, [{ regular_id: 2040435000, item_name: 'Tetragod', count: 1 }]);
});

test('countCrateDuplicates skips entries with no parseable list', () => {
  /**
   * Given a capture whose responseBody is not valid JSON,
   * When countCrateDuplicates is called,
   * Then it returns an empty array instead of throwing.
   */
  const result = countCrateDuplicates([{ responseBody: 'not json' }], '2');
  assert.deepStrictEqual(result, []);
});
```
Run `node --test test/itemStats.test.mjs` — stub `export function countCrateDuplicates() {}` first so it fails on the assertion, not an import error.

**Green**
```js
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
```

**Refactor** — none needed.

### Behavior 3 — `countInventoryDuplicates` groups owned items by `master.id`, splitting plain spares from already-uncapped copies

Filters by endpoint URL (not `item_kind_id`, which doesn't exist in this shape) so Weapons later is `countInventoryDuplicates(captures, '/weapon/list/')` — same function, new call site.

**Design** (settled via grilling): no folded/weighted total. Each owned copy's `param.evolution` is its uncap star level. A 0★ copy is a plain spare, so those are tallied into `zeroStarCount`. Any copy with `evolution > 0` is kept as its own entry in `nonZeroStars` rather than summed, so you can judge each one yourself instead of trusting a derived number. A `master.id` is only reported when it has more than one owned copy total (`zeroStarCount + nonZeroStars.length > 1`) — a single copy isn't a duplicate. `DUPE_STAR_CAP` (flat 3, since only the first 3 stars are typically duplicate-fed) is deliberately unused for now — nothing currently folds evolution into a number, so there's nothing to cap. Revisit if a future feature needs a single derived total.

**Red**
```js
test('countInventoryDuplicates splits a 0★ copy and a 1★ copy of the same summon', () => {
  /**
   * Given two owned copies of the same summon (master.id 2040158000): one at 0 uncap stars
   * (param.evolution '0') and one at 1 uncap star (param.evolution '1'),
   * When countInventoryDuplicates is called with urlPattern '/summon/list/',
   * Then zeroStarCount is 1 and nonZeroStars lists the single 1★ copy by its own param.id.
   */
  const responseBody = JSON.stringify({
    list: [
      { param: { id: 1243639174, evolution: '0' }, master: { id: 2040158000 } },
      { param: { id: 1208254746, evolution: '1' }, master: { id: 2040158000 } },
    ],
  });
  const entry = { url: 'https://game.granbluefantasy.jp/summon/list/2?...', responseBody };
  const result = countInventoryDuplicates([entry], '/summon/list/');
  assert.deepStrictEqual(result, [
    { master_id: 2040158000, zeroStarCount: 1, nonZeroStars: [{ param_id: 1208254746, evolution: 1 }] },
  ]);
});

test('countInventoryDuplicates lists every non-0★ copy individually, matching the real 4x duplicate seen in inventory-summon.json', () => {
  /**
   * Given a captured /summon/list/ response whose list contains four param/master items sharing
   * master.id 2040158000 (the real duplicate from inventory-summon.json, param.ids 1243639174,
   * 1208254746, 1091463657, 1067755759, all at evolution '3' in the real data),
   * When countInventoryDuplicates is called with urlPattern '/summon/list/',
   * Then zeroStarCount is 0 and nonZeroStars lists all four copies individually at evolution 3,
   * not a single folded number.
   */
  const responseBody = JSON.stringify({
    list: [
      { param: { id: 1243639174, evolution: '3' }, master: { id: 2040158000 } },
      { param: { id: 1208254746, evolution: '3' }, master: { id: 2040158000 } },
      { param: { id: 1091463657, evolution: '3' }, master: { id: 2040158000 } },
      { param: { id: 1067755759, evolution: '3' }, master: { id: 2040158000 } },
    ],
  });
  const entry = { url: 'https://game.granbluefantasy.jp/summon/list/2?...', responseBody };
  const result = countInventoryDuplicates([entry], '/summon/list/');
  assert.deepStrictEqual(result, [
    {
      master_id: 2040158000,
      zeroStarCount: 0,
      nonZeroStars: [
        { param_id: 1243639174, evolution: 3 },
        { param_id: 1208254746, evolution: 3 },
        { param_id: 1091463657, evolution: 3 },
        { param_id: 1067755759, evolution: 3 },
      ],
    },
  ]);
});

test('countInventoryDuplicates omits a master.id with only one owned copy', () => {
  /**
   * Given a single owned copy of a summon (no duplicate),
   * When countInventoryDuplicates is called,
   * Then the result is empty — one copy isn't a duplicate.
   */
  const responseBody = JSON.stringify({
    list: [{ param: { id: 1, evolution: '0' }, master: { id: 2040158000 } }],
  });
  const entry = { url: 'https://game.granbluefantasy.jp/summon/list/2?...', responseBody };
  const result = countInventoryDuplicates([entry], '/summon/list/');
  assert.deepStrictEqual(result, []);
});

test('countInventoryDuplicates ignores captures whose url does not match urlPattern', () => {
  /**
   * Given a capture from an unrelated endpoint (e.g. /present/list/) containing items that would
   * otherwise look like param/master data,
   * When countInventoryDuplicates is called with urlPattern '/summon/list/',
   * Then that capture is ignored entirely and the result is empty.
   */
  const entry = {
    url: 'https://game.granbluefantasy.jp/present/list/2/0/2?...',
    responseBody: JSON.stringify({
      list: [
        { param: { id: 1, evolution: '0' }, master: { id: 2040158000 } },
        { param: { id: 2, evolution: '0' }, master: { id: 2040158000 } },
      ],
    }),
  };
  const result = countInventoryDuplicates([entry], '/summon/list/');
  assert.deepStrictEqual(result, []);
});

test('countInventoryDuplicates dedupes by param.id so a re-captured owned item is not counted twice', () => {
  /**
   * Given two /summon/list/ captures: the first has two owned 0★ copies (param.id 1 and 2) of the
   * same summon, the second re-sends param.id 1 (e.g. the inventory page loaded twice),
   * When countInventoryDuplicates is called across both captures,
   * Then zeroStarCount is 2, not 3 — the repeated param.id 1 isn't double-counted.
   */
  const first = {
    url: 'https://game.granbluefantasy.jp/summon/list/2?...',
    responseBody: JSON.stringify({
      list: [
        { param: { id: 1, evolution: '0' }, master: { id: 2040158000 } },
        { param: { id: 2, evolution: '0' }, master: { id: 2040158000 } },
      ],
    }),
  };
  const second = {
    url: 'https://game.granbluefantasy.jp/summon/list/2?...',
    responseBody: JSON.stringify({ list: [{ param: { id: 1, evolution: '0' }, master: { id: 2040158000 } }] }),
  };
  const result = countInventoryDuplicates([first, second], '/summon/list/');
  assert.deepStrictEqual(result, [{ master_id: 2040158000, zeroStarCount: 2, nonZeroStars: [] }]);
});
```
Run `node --test test/itemStats.test.mjs` — stub `export function countInventoryDuplicates() {}` first so it fails on the assertion, not an import error.

**Green**
```js
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
```

**Refactor** — none needed.

## Manual verification (browser plumbing, not unit-testable without a heavier framework)

1. `chrome://extensions` → enable Developer mode → "Load unpacked" → select this project folder.
2. Switch to the already-open GBF tab (`game.granbluefantasy.jp/#mypage`), open DevTools, find the new "API Capture" panel tab.
3. User (not Claude) opens the Present list → panel table should show a new row live, and **Unclaimed Summon Duplicates** should show a repeat if one exists (matching what `present.json` showed us for real).
4. User navigates to the Summon list page → panel captures `/summon/list/{page}` requests, and **Summon Inventory Duplicates** should show any repeated `master.id` — a 0★ tally plus individually-listed starred copies (matching the real 4x duplicate seen in `inventory-summon.json`: zeroStarCount 0, four individually-listed 3★ copies, if that same summon is still owned).
5. Click a row → expanded `<pre>` shows the pretty-printed request/response JSON.
6. Click "Export JSON" → a `captures.json` file downloads with all captured entries.
7. Click "Clear" → table and both duplicate sections empty, and `chrome.storage.local` is cleared.
8. Click "Import JSON" and pick the just-exported `captures.json` → table and both duplicate sections repopulate; re-importing the same file again afterward must not duplicate rows (proves `mergeEntries` dedup works end-to-end, not just in the unit test).

## Constraints checklist

- [ ] No production code written before a failing test points at it (applies to `ringBuffer.js` only — DOM/chrome plumbing has no automated test, called out explicitly above)
- [ ] No feature flags, backwards-compat shims, or half-finished abstractions
- [ ] Imports use plain ESM `export`/`import`, consistent within the small file set (no mixed CJS/ESM)
- [ ] No comments added unless the WHY is non-obvious (e.g. why DevTools must be open for capture to work at all)
