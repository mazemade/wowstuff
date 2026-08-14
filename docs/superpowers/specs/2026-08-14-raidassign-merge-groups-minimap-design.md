# RaidAssign merge, auto-grouping, and minimap button — design

Date: 2026-08-14
Status: approved in chat, pending spec review

## Goal

One in-game addon that covers the whole raid-night loop: scan the raid's talents,
paste the web tool's output back in, whisper everyone their duties, and put every
player into their optimizer-assigned subgroup with one click — all reachable from
a minimap icon.

Today this is split across two standalone addons (RaidSpecScan for the scan,
RaidAssign for the whispers), and the group layout computed by `proposeGroups`
in `assignments-engine.js` never leaves the browser: the raid leader drags
players between groups by hand.

## Decisions already made

- **Merge** RaidSpecScan into RaidAssign; one addon owns scan, send, and grouping.
- **One paste imports everything** (whispers + group layout). Importing never
  sends and never moves anyone; separate buttons act on each part.
- **Auto-group is one-shot**: clicking it rearranges the raid once to match the
  loaded layout. No background enforcement; re-click after late joiners.

## 1. Addon merge

`RaidAssign` becomes a three-file addon:

| File | Contents |
|---|---|
| `RaidAssign/Scan.lua` | Current `RaidSpecScan/RaidSpecScan.lua`, moved intact. Keeps `/specscan` and the RSS3 export format. |
| `RaidAssign/RaidAssign.lua` | Existing paste/whisper flow plus RSW2 parsing, the Apply groups button, and the group engine. Keeps `/specsend`. |
| `RaidAssign/Minimap.lua` | New minimap button and menu. |

The `.toc` lists the three files; `SavedVariables: RaidAssignDB` is unchanged
(RaidSpecScan has no saved variables, so nothing migrates). The `RaidSpecScan/`
folder is deleted from the repo, and `raid-spec-scan.test.lua` loads
`RaidAssign/Scan.lua` instead. The raid leader deletes the old RaidSpecScan
folder from their AddOns directory once; raiders never installed either addon,
so nobody else is affected.

Scan and send remain decoupled in code: `Scan.lua` and `RaidAssign.lua` share no
state; `Minimap.lua` reaches each through its slash handler or an exposed
function. A load failure in one must not break the other.

## 2. Wire format: RSW1 → RSW2

The web tool's Addon tab payload gains the group layout at the end:

```
RSW2
Alice=Your assignment text…
Bob=…
@G1=Alice,Bob,Carol,Dan,Eve
@G2=…
```

- Header becomes `RSW2`. Whisper lines are unchanged (`Name=body`).
- Group lines are `@G<n>=<comma-separated names>`, `n` in 1..8, emitted in group
  order, only for groups the optimizer filled. Names are short names (no realm
  suffix), matching the whisper lines.
- `@` cannot start a WoW character name, so group lines are unambiguous.
- Unplaced players (`proposeGroups(...).unplaced`) simply do not appear in any
  `@G` line.
- The addon accepts **both** `RSW1` (whispers only, no layout) and `RSW2`.
  A `RSW2` payload with no `@G` lines is valid and equivalent to RSW1.
- Malformed `@G` lines (bad group number, empty name list) are reported like
  today's malformed whisper lines, not silently dropped. A name appearing in two
  groups keeps its first placement; the duplicate is reported.

## 3. Import never acts

Pressing **Load** parses whispers and layout into memory, nothing more. The
preview window shows the whisper list exactly as today, plus a status line —
"Group layout loaded: 6 groups, 25 players" (or nothing for RSW1) — and one new
button, **Apply groups**, alongside Send changed / Send all. One paste, then the
leader chooses: send only, group only, or both, in either order.

The loaded layout lives in memory only (like `sheet` does today): a `/reload`
drops it and the leader re-pastes.

## 4. Auto-group engine (one-shot)

**Guards, checked at click time:** in a raid; player is leader or assist
(`UnitIsGroupLeader` / `UnitIsGroupAssistant`); not in combat
(`InCombatLockdown`); a layout is loaded. Each failure gets its own plain
message.

**Model:** build `target[name] = groupIndex` from the `@G` lines (short names,
lowercased, same normalization as `RaidTargets()`). Raid members not in the
layout are never moved; layout names not in the raid are reported at the end.

**Execution:** a throttled queue on an `OnUpdate` frame, one roster operation
every 0.5 s — the server needs `GROUP_ROSTER_UPDATE` to settle between moves,
so the engine re-reads the live roster every tick rather than precomputing a
move list. Each tick:

1. Read the roster via `GetRaidRosterInfo`; find the first player whose current
   subgroup ≠ target.
2. If the target group has fewer than 5 members: `SetRaidSubgroup(index, target)`.
3. Otherwise pick a misplaced occupant of the target group and
   `SwapRaidSubgroups(i, j)` — preferring an occupant whose own target is the
   mover's current group, so one swap fixes two players.
4. If every occupant of the target group is correctly placed there, the layout
   over-fills that group (payload bug or manual edits): skip this player,
   report them at the end.

A cap of 50 operations guards against livelock. Entering combat mid-run aborts
with a message; the raid is left in whatever intermediate state it reached
(harmless — re-click after combat). On completion: "Groups applied — N moves"
plus, when relevant, "not in raid: …" and "could not place: …".

**Testability:** the tick logic is pure over `GetRaidRosterInfo`,
`SetRaidSubgroup`, and `SwapRaidSubgroups`, all stubbable under LuaJIT exactly
like the scan test stubs its globals.

## 5. Minimap button

Hand-rolled — this codebase deliberately uses no addon libraries. A standard
round 32 px button pinned to the minimap rim, draggable around the rim; its
angle persists in `RaidAssignDB.minimap.angle`. Tooltip shows addon name and
current state ("layout loaded: 25 players" / "no payload loaded").

Clicking (either mouse button) opens a small dropdown menu:

- **Scan raid** — runs the scan and opens its export window (same as `/specscan`).
- **Assignments…** — opens the paste/preview window (same as `/specsend`).
- **Apply groups** — runs the engine directly if a layout is loaded; otherwise
  prints "no layout loaded — open Assignments and paste one".

The menu uses the client's built-in `UIDropDownMenu` machinery (present in
2.5.x); no library needed.

## 6. Web tool change

`buildAddonWhispers` in `assignments-engine.js` takes the `proposeGroups` result
as an additional argument and appends the `@G` lines after the whisper lines;
the Addon tab wiring in `assignments.js` passes it through. Header string
becomes `RSW2`. No UI changes beyond the payload content.

## 7. Testing

- **JS** (`assignments-engine.test.js`, run via `npm test`): RSW2 header;
  `@G` line format and ordering; players in `unplaced` omitted; payload with no
  groups still parses as valid RSW2.
- **Lua**: new `raid-assign.test.lua` at repo root, same
  LuaJIT-with-stubbed-globals harness as `raid-spec-scan.test.lua`. Covers:
  - `ParsePayload`: RSW1 accepted; RSW2 with and without `@G` lines; malformed
    group lines reported; duplicate names keep first placement.
  - Group engine, driven tick by tick against a stubbed roster: simple move
    into a group with room; swap when the target group is full; three-way
    cycle resolves; layout names missing from the raid are reported, not
    moved; over-filled target group skips and reports; combat flag aborts;
    operation cap halts a deliberately impossible layout.
  - Existing `raid-spec-scan.test.lua` still passes after the file move.

## Out of scope

- Continuous group enforcement after the one-shot apply.
- Any change to the RSS3 scan format or the scan flow itself.
- Migrating RaidSpecScan users automatically (nothing to migrate).
