# CLAUDE.md

A Chrome (Manifest V3) DevTools extension: a "Gebe" panel that watches Granblue Fantasy's (`game.granbluefantasy.jp`) traffic to count duplicate summons and weapons and track friends' supports. Plain ESM, no `package.json`, no build step.

Use the terms in `GLOSSARY.md` (capture, crate, support…) in code, UI and replies.

## Commands

- Tests: `node --test test/*.test.mjs`
- Load: `chrome://extensions` → Developer mode → "Load unpacked" → this directory.
- After any code change: reload the extension **and** fully close and reopen DevTools on the game tab. A reload alone can leave an open panel running stale JS.
- Release: `just release X.Y` bumps `version` in `manifest.json` in its own commit (`Bump version to X.Y`), tags `vX.Y` and pushes. The tag push runs `.github/workflows/release.yml`, which zips the repo with `git archive` (leave files out with `export-ignore` in `.gitattributes`) and creates the GitHub release.

## Verifying

Only the pure functions in `src/` have tests. The panel isn't a regular tab, so its DOM and state can't be inspected programmatically. Check a change by feeding real captured data to `src/`, or by asking the user to look at the panel or export `captures.json` with its "Export JSON" button.

`sample/` holds real API responses (gitignored: it's the user's account data, never commit it). Check a response's shape there before writing code against it.

## Architecture

- `devtools.js` (the `devtools_page`) captures game requests via `chrome.devtools.network.onRequestFinished`, which only fires while DevTools is open on that tab. It reduces each capture to the storage keys below; raw captures are saved only while capturing is on. Every storage write goes through one promise chain, since GBF fires concurrent requests.
- `panel.js` renders the storage keys and re-renders on `chrome.storage.onChanged`.
- `src/itemStats.js` handles duplicates (crate + inventory, SS Rare only); `src/supporters.js` handles friends' supports.

## Storage keys

| Key | Written by | Wiped by |
|---|---|---|
| `crate`, `ownedSummons`, `ownedWeapons` | `devtools.js`, Import JSON | Clear |
| `captures` (raw, only while capturing) | `devtools.js` | Clear, Start capturing |
| `capturing` | panel's Start/Stop; reset to off each time DevTools opens | — |
| `friends` | `devtools.js` (supporter pages, Details) | Clear friends, per-friend delete |
| `friendList` (`{userId: {name, page}}`, from the friend list pages) | `devtools.js` | per-friend delete |
| `hiddenFriends` (`{userId: note}`) | panel | per-friend delete |
| `watchedSummons`, `summonMinLevels` | panel | — |

Item keys are objects keyed by present id / owned-copy id, so a re-fetched page overwrites instead of double-counting. Import JSON runs an export through `extractItems`; it doesn't restore raw captures. Storage isn't capped in code: the manifest requests `unlimitedStorage`.
