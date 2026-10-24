# Gebe

A Chrome DevTools extension for [Granblue Fantasy](https://game.granbluefantasy.jp) that watches the game's network traffic to:

- count your duplicate SS Rare summons and weapons, across your crate and your inventory;
- track your friends' supports, flag friends missing a summon you rely on, and show which supports your friends offer most.

## Install

1. Download the latest `gebe-vX.Y.zip` from [Releases](https://github.com/Akenaide/gebe/releases) and unzip it (or clone this repo).
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the unzipped directory.

## Use

Open DevTools on a `game.granbluefantasy.jp` tab and switch to the **Gebe** panel, then play as normal. Gebe only sees the tab DevTools is open on.

**Note:** DevTools must stay open on the tab for capture to keep working — this is a Chrome limitation on the underlying API, not specific to this extension. After updating the extension's code, reload it on `chrome://extensions` *and* fully close and reopen DevTools; reloading the extension alone can leave a stale panel running.

**One tab at a time:** keep DevTools open on only one game tab. Every open DevTools shares Gebe's storage, so with two at once the current raid flips between both tabs' raids, and opening DevTools turns capturing off for both.

### Duplicates

1. Browse your present box and summon/weapon inventory in-game as normal — the extension saves the SS Rare items it sees (not the raw traffic).
2. Every SS Rare item shows up as a card, single copies included, with a total count and a breakdown of where the copies are (unclaimed vs. owned, and uncap ★ level for owned copies).
3. A colored dot on a card's thumbnail flags items worth a second look: amber for exactly 3 copies, green for 4+.
4. Click an item's name to open its page on [gbf.wiki](https://gbf.wiki).
5. Gebe only adds what it sees, never removes: a present you claim stays counted as unclaimed, and a copy you sell or use as fodder stays counted as owned. After claiming, selling or uncapping, press **Clear** and browse your crate and inventory again.

### Friends

1. Open supporter pages before battles: Gebe records each friend's supports and the level of each one. Opening a friend's **Details** from the friend list also records their whole layout.
2. Click summons in the picker to watch them, optionally with a minimum level. The list then shows only the friends who don't offer a watched summon at that level. **Show all friends** lists everyone.
3. Browse your friend list pages to see, by page, which friends have no record yet, and open their Details to fill them in.
4. Hide a friend you don't want flagged, or delete them; **Clear friends** wipes every record.

### Stats

A table of every support your friends offer, sortable by name or by how many friends offer it. Click a level to list who offers it.

### Raids

1. **Backup requests:** open the game's backup screen. Each list it polls shows every request's boss HP%, host, members and time left. Set a **Target HP%** for a quest to sort its requests by how close they are, the closest one highlighted. A list stops updating when you leave the backup screen and is hidden after 5 minutes; **Clear raids** wipes them all.
2. **Current raid:** enter a raid with DevTools open. Gebe shows the boss HP%, the battle ID, each player's honors and how long ago they last acted, and the raid log. HP, honors and last actions update every second (a player's last action is when their honors last went up); the raid log only when you open the game's battle log, timed to the minute (`~`).

## Development

No build step, no dependencies — plain ESM JavaScript run directly by the browser or Node.

```sh
node --test test/*.test.mjs   # run the test suite
node --check <file>           # syntax-check a file without running it
just release X.Y              # bump manifest.json, commit, tag vX.Y and push
```

Pushing a `vX.Y` tag runs a GitHub Action that zips the extension and publishes it as a release. Files marked `export-ignore` in `.gitattributes` are left out of the zip.

See `CLAUDE.md` for architecture notes.
