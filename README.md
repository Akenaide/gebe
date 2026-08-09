# Gebe

A Chrome DevTools extension for [Granblue Fantasy](https://game.granbluefantasy.jp) that watches network traffic and shows which Summons and Weapons you have duplicates of — both unclaimed in your present box and already in your inventory.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this directory.

## Use

1. Open DevTools on a `game.granbluefantasy.jp` tab and switch to the **Gebe** panel.
2. Browse your present box and summon/weapon inventory in-game as normal — the extension listens passively and records what it sees.
3. Duplicates show up as a grid of cards, one per item, with a total count and a breakdown of where the copies are (unclaimed vs. owned, and uncap ★ level for owned copies).
4. A colored dot on a card's thumbnail flags items worth a second look: amber for exactly 3 copies, green for 4+.
5. Click an item's name to open its page on [gbf.wiki](https://gbf.wiki).
6. Use **Export JSON** / **Import JSON** to back up or merge capture data across sessions, and **Clear** to wipe it.

**Note:** DevTools must stay open on the tab for capture to keep working — this is a Chrome limitation on the underlying API, not specific to this extension. After updating the extension's code, reload it on `chrome://extensions` *and* fully close and reopen DevTools; reloading the extension alone can leave a stale panel running.

## Development

No build step, no dependencies — plain ESM JavaScript run directly by the browser or Node.

```sh
node --test test/*.test.mjs   # run the test suite
node --check <file>           # syntax-check a file without running it
```

See `CLAUDE.md` for architecture notes.
