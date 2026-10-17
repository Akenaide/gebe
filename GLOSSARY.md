# Gebe

A DevTools panel that watches Granblue Fantasy's game traffic to count duplicate summons and weapons, and to track friends' supports.

Field names copied from the game's API (`evolution`, `fixed_summon`…) keep the game's naming.

## Capturing

**Capture**:
One saved game request together with its response.
_Avoid_: Record, entry, log

**Capturing**:
The state in which Gebe saves game traffic as captures. It is off until the player turns it on.
_Avoid_: Recording, auto-record

## Collection

**Crate**:
The player's unclaimed presents, which may hold summons or weapons not yet in the inventory.
_Avoid_: Presents, gift box

**Inventory**:
The summons and weapons the player owns.
_Avoid_: Collection, stash

**Duplicate**:
A summon or weapon seen more than once across the crate and the inventory. The Duplicates tab also lists single copies, so the player sees what they own only once.
_Avoid_: Dupe, copy

**Uncap**:
How far an owned copy has been upgraded, counted in stars (0★ is a plain copy).
_Avoid_: Evolution

## Friends

**Support**:
A summon a friend has set out for other players to borrow.
_Avoid_: Supporter summon, friend summon

**Supporter page**:
The game's page listing supports to borrow before a battle, where Gebe sees friends' supports.
_Avoid_: Support list, raid page

**Layout**:
All of a friend's supports, slot by slot.
_Avoid_: Setup, loadout

**Level**:
A support's summon level, as shown on a supporter page or Details. It is unrelated to uncap.
_Avoid_: Rank

**Slot**:
The place a support occupies in the friend's support layout, given as an element tab and a row. It is unrelated to the summon's own element.
_Avoid_: Position, tab

**Sighting**:
One time Gebe saw a friend's supports on a supporter page. Opening their Details is not a sighting.
_Avoid_: Visit, view

**Details**:
A friend's page reached from the friend list, showing every slot of their supports, empty ones included.
_Avoid_: Profile, fixed summons

**Watched summon**:
A summon the player expects friends to offer as a support, optionally with a minimum level.
_Avoid_: Wanted summon, tracked summon

## Raids

**Backup request**:
A raid another player opened to helpers, listed on the game's backup screen with its boss HP%. The API calls it an assist.
_Avoid_: Raid call, SOS

**Target HP%**:
The boss HP% the player wants to join a backup request at; the closest request is highlighted.
_Avoid_: Wanted HP, HP goal

**Current raid**:
The raid the player is in, followed from its start until the result page: boss HP, MVP ranking and raid log.
_Avoid_: Active battle, live raid

**Raid log**:
Every player's actions in the current raid, as the game sends them over the raid socket.
_Avoid_: Battle log (the game's own on-demand log), action feed
