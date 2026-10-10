# Gebe

A DevTools panel that watches Granblue Fantasy's game traffic to count duplicate summons and weapons, and to track friends' supports.

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
A summon or weapon seen more than once across the crate and the inventory.
_Avoid_: Dupe, copy

**Uncap**:
How far an owned copy has been upgraded, counted in stars (0★ is a plain copy).
_Avoid_: Evolution, level

## Friends

**Support**:
A summon a friend has set out for other players to borrow.
_Avoid_: Supporter summon, friend summon

**Slot**:
The place a support occupies in the friend's support layout, given as an element tab and a row. It is unrelated to the summon's own element.
_Avoid_: Position, tab

**Sighting**:
One time Gebe saw a friend's supports.
_Avoid_: Visit, view

**Watched summon**:
A summon the player expects friends to offer as a support, optionally with a minimum level.
_Avoid_: Wanted summon, tracked summon
