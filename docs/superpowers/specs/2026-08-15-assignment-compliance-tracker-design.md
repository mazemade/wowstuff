# Assignment Compliance Tracker — Design

**Date:** 2026-08-15
**Status:** Approved design, pending implementation plan

## Problem

The web tool produces assignments — who maintains which boss debuff, which totem each
group gets — but nothing verifies execution. The raid leader wants to see, *during* a
boss fight and immediately after it, whether assigned debuffs and group buffs were
actually kept up, and by whom. Warcraft Logs cannot serve this: even live logging is
only queryable a minute or two after a fight ends and depends on someone uploading.

## Decision

Track in-game, in the existing RaidAssign addon. The web tool's only new job is to
ship a machine-readable tracking section in the addon payload, so the addon knows
which spell IDs to watch and who is accountable for each. One client running the
addon (the raid leader) sees everything: boss debuffs arrive via the combat log, and
raid-member buffs (totems) are readable at any range via UnitAura.

Out of scope for v1: blessing checks at the pull, trash fights, any WCL integration.

## 1. Payload: RSW3 `@T` lines

The Addon tab export bumps its version line to `RSW3`. The addon accepts RSW1/2/3;
older payloads simply load with no tracking. New line type, one per tracked item:

```
@T D|coe|Curse of Elements|27228,11722,11721,1490|Zugzug
@T B|wf|Windfury Totem|25587,25505|3|Thrallson
```

- `D` (boss debuff): `id | display name | spellIDs, all ranks | assigned player`
- `B` (group buff): `id | display name | spellIDs, all ranks | group number | provider`

Web-tool side: `DEBUFF_CATALOG` entries and the totem tables in
`assignments-engine.js` gain `spellIds` arrays (all TBC ranks — combat log events
carry the rank actually cast). For `B` lines these are the **aura IDs seen on
players**, not the totem cast IDs (e.g. Windfury Totem's cast and its party aura
are different spells); every ID list must be verified against the Anniversary
client during implementation — the examples above are illustrative. The export walks the same assignment results it
already renders, so the `@T` lines always match the sheet on screen. Assignments the
engine marks unassigned/uncovered produce no `@T` line.

## 2. Addon tracker: `Track.lua`

New file, wired like the others: talks to the rest only through `RaidAssignAPI` and
its own events, so a load failure leaves scan/whisper/groups working.

**Fight segmentation.** `ENCOUNTER_START` begins a pull, `ENCOUNTER_END` closes it
(boss fights only). The encounter's boss GUIDs are collected from `boss1..boss5`
unit IDs at start and from combat-log dest GUIDs whose unit type is `Creature` with
the encounter's NPC IDs.

**Boss debuffs.** `COMBAT_LOG_EVENT_UNFILTERED`, filtered to
`SPELL_AURA_APPLIED/REFRESH/REMOVED` where destGUID is a boss and spellId is in a
tracked set. Per assignment we accumulate: total uptime, and uptime attributable to
the assigned player (sourceGUID match), so the report can distinguish "up, but the
wrong warlock carried it" from "up and done by the assignee". `SPELL_AURA_REMOVED`
may not fire on boss death; the fight end closes any open interval.

**Group buffs.** A periodic scan (every 1s, plus on `GROUP_ROSTER_UPDATE`) of each
group's members via `UnitAura`, checking presence of the tracked spell IDs. Group
uptime = mean over the group's living members of their individual buffed time /
alive time. Dead time doesn't count against anyone.

**Storage.** Per-pull results (encounter id/name, pull number, duration, per-item
stats) go to `RaidAssignDB.pulls`, capped at the most recent 20.

## 3. Live view

A small movable frame shown only while an encounter is running (and only if a
tracking payload is loaded). One row per tracked item: name, live uptime %, and —
when the aura is currently missing — "down Ns" in red. No sound, no chat output,
no whispers; it exists so the raid leader can call things on voice. Position saved
in `RaidAssignDB.minimap`-style fashion; a toggle to disable the live view entirely.

## 4. Post-fight overview + selective whispers

`/racheck` (and the minimap hub button) opens the overview for the most recent pull,
with a dropdown to pick an older stored pull. Rows: assignment, uptime %, assigned
player, share of uptime provided by that player. Color coding: green ≥ 90 %, yellow
≥ 70 %, red below. Each row with an accountable player has a checkbox; a **Whisper
selected** button sends each chosen player one factual whisper —
`Gruul pull 3: Curse of Elements up 41% — assigned to you` — through the existing
throttled whisper queue in `RaidAssign.lua`. Nothing sends without that click.
An optional **Post summary** button prints the scoreboard to raid chat, also
manual-only.

## 5. Minimap hub

Replace the cursor dropdown in `Minimap.lua` with a compact hub panel anchored near
the minimap button: title, a status line (payload loaded? groups applied? last pull
headline, e.g. "Gruul #3 — 2 items below 90%"), and buttons: **Scan raid**,
**Assignments…**, **Apply groups**, **Check results**. Same hand-rolled plain-frame
style (no EasyMenu — it's absent on wow_anniversary 2.5.6), click-outside or
re-click closes it.

## 6. Error handling

- No tracking payload loaded → tracker idles; live view never appears; `/racheck`
  says what to do ("load an RSW3 payload from the web tool").
- Assigned player absent from the raid at pull start → row flagged "assignee not in
  raid" instead of accusing them of 0 %.
- Unknown/malformed `@T` line → skipped with one warning print, rest of payload loads.
- Mid-fight `/reload` → that pull's partial data is discarded (accepted limitation).

## 7. Testing

- **Engine (jest):** `@T` line generation from a fixture roster — exact expected
  lines, including the no-line case for uncovered debuffs; spellIds present for
  every catalog entry that can be assigned.
- **Addon (lua, like `raid-assign.test.lua`):** payload parsing (RSW3 with/without
  `@T`, malformed lines); uptime accumulation math driven by a scripted sequence of
  synthetic aura events with fixed timestamps, including attribution split and
  fight-end interval closing; group-buff mean-uptime math with a death mid-fight.
- **Manual gate:** one raid (or target-dummy party test) confirming live rows move
  and the overview matches a WCL log of the same fight after the fact.
