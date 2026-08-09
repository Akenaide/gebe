# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Chrome (Manifest V3) DevTools extension that watches Granblue Fantasy's (`game.granbluefantasy.jp`) network traffic and surfaces duplicate-summon counts. It adds a "Gebe" panel next to Elements/Console/Network in DevTools.

No `package.json`, no npm dependencies, no build step. Everything is plain ESM JavaScript run directly by the browser (extension files) or Node (tests).

## Commands

- Run all tests: `node --test test/*.test.mjs`
- Run one test file: `node --test test/itemStats.test.mjs`
- Syntax-check a file without running it: `node --check <file>`
- Load the extension: `chrome://extensions` → enable Developer mode → "Load unpacked" → select this directory.
- After any code change: reload the extension on `chrome://extensions`, **and** fully close and reopen DevTools on the target tab. Reloading the extension alone does not reliably refresh an already-open DevTools panel — it can keep running stale JS until DevTools itself is closed and reopened.

There is no way to inspect the DevTools panel's own DOM/state programmatically (it isn't a regular tab) — debugging it means either reasoning from the pure functions in `src/` directly (feed them real captured data), or asking the user to check the panel and/or export `captures.json` via the panel's own "Export JSON" button.

## Architecture

**Capture side** (`devtools.js`, loaded via `devtools.html` as the `devtools_page`): registers `chrome.devtools.network.onRequestFinished`, which only fires while DevTools is open on that tab (same limitation as the Network tab). For each finished request it reads the request body and calls `getContent()` for the response body, then appends a capture record to `chrome.storage.local` under the key `captures`. Writes are serialized through a single promise chain, since GBF fires several concurrent requests and a naive read-modify-write can race and drop captures. Storage isn't size-capped in code — the manifest requests `unlimitedStorage` instead.

**Display side** (`panel.html`/`panel.js`/`panel.css`, the actual panel tab `chrome.devtools.panels.create` registers): reads `captures` from storage, re-renders on `chrome.storage.onChanged`, and offers Export JSON / Import JSON (merges via `mergeEntries`, deduped by capture `id`) / Clear.

**Pure aggregation logic** lives in `src/` and is unit-tested with `node:test` — this is the only code covered by automated tests; everything DOM/`chrome.*`-related is verified manually per the note above.

- `src/itemStats.js` — the core domain logic. Two API shapes are aggregated separately because they don't share fields, then merged:
  - `countCrateDuplicates(entries, itemKindId)` — from `/present/list/{cat}/{sub}/{page}` responses (the "crate": unclaimed presents). Items are flat: `{id, item_kind_id, regular_id, item_name, rarity, attribute}`. Only `rarity === '4'` (SS Rare) items are counted. `attribute` (a numeric code) is resolved to a name via the hardcoded `ATTRIBUTE_NAMES` table in this file — deliberately *not* via the response's own `sort` map, since that shouldn't be trusted as the source of truth. Dedupes by the item's own `id` so re-fetching the same page doesn't double-count.
  - `countInventoryDuplicates(entries, urlPattern)` — from `/summon/list/{page}` responses (the real owned-summon collection). Completely different item shape: `{param: {id, evolution, ...}, master: {id, rarity, ...}}` — no `item_kind_id`, `regular_id`, `item_name`, or `attribute` field exists here at all. `param.id` is the unique owned-instance id (dedup key); `master.id` is "which summon" and lives in the *same numeric id space* as `regular_id`/the CDN image id (e.g. `2040158000`) — that's what lets the two shapes be merged later. Splits each summon's owned copies into `zeroStarCount` (plain 0★ spares, tallied as a count) and `nonZeroStars` (each already-uncapped copy listed individually with its own star level, not folded into a number) — a deliberate design choice from user feedback, since folding uncap stars into a single weighted total misrepresented the data (most uncap stars come from resource items, not from feeding a duplicate).
  - `combineDuplicateSections(crateDupes, inventoryDupes)` — merges both by numeric id into one row per summon: `{id, item_name, attribute_name, crateCount, zeroStarCount, nonZeroStars}`. Shows *every* summon seen (not just ones exceeding some duplicate threshold — an earlier per-source `>1` filter was explicitly removed because it could hide a real combined duplicate, e.g. 2 unclaimed + 1 owned). `item_name`/`attribute_name` are `null` for inventory-only rows, since that endpoint has no such fields. Sorted ascending by name, falling back to id-as-text when there's no name.
- `src/ringBuffer.js` — `mergeEntries(existing, imported)`, dedupes by capture `id` for the Import flow.

## Reference data

`sample/` (gitignored — contains the user's real account data, never commit it) holds real captured API responses used to verify assumptions about response shape before writing code against them: `present.json` (crate), `inventory-summon.json` (inventory), and ad-hoc exports like `captures-bug-1.json`/`bug1.json` used while debugging specific reported issues. When investigating a shape question, check here before guessing.

`plans/` holds the original implementation plan (TDD-style, written via the `spec`/`grilling` skill flow) — useful context for *why* the architecture looks the way it does.
