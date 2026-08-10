# Raid Assignments Tool — Design

**Date:** 2026-08-10
**Status:** Approved pending user review
**Project:** wowstuff (TBC Anniversary raid tools)

## Purpose

For 25-man TBC Anniversary raids: import the raid roster, automatically assign
per-player duties (boss debuffs, cooldown targets, crowd-control marks), and
communicate each player's exact assignment via Discord or in-game chat.

Extends the existing raid positioning tool (gruul/magtheridon/ssc pages) with a
new fight-independent page. One global assignment set per roster — not per-boss.

## Scope

Three assignment categories:

1. **Boss debuffs** — the core feature. Who keeps which debuff on the boss.
2. **Cooldowns** — Innervate targets (e.g. mages, one reserved for healers),
   Soulstone targets.
3. **Crowd control** — raid-target marks mapped to CC ability + player
   (e.g. Moon = Polymorph by MageA, Square = Sap by RogueX).

Out of scope for v1: raid buffs (Blessings matrix, Fort/Int/MotW), interrupt
rotations, dispel duties, per-boss assignment variants.

## Architecture

Same stack as the rest of the repo: vanilla HTML/JS/CSS pages served by the
existing Express server ([server.js](../../../server.js)), deployed on Railway.
No database — state lives in localStorage and share-links encode state in the
URL.

New files:

| File | Purpose |
|---|---|
| `assignments.html` | Main page: import, roster, assignments, output |
| `assignments.js` | Page logic (DOM, import flows, output rendering) |
| `assignments-engine.js` | Pure assignment logic + debuff catalog. No DOM. Testable in Node. |
| `assignments-view.html` (+ reuse pattern of `view.js`) | Read-only share view |
| `assignments-engine.test.js` | Node-runnable tests, no framework |
| `RaidSpecScan/` (`.toc` + `.lua`) | In-game addon: scans raid specs, produces export string |
| `server.js` (edit) | Add `GET /api/raidhelper/:eventId` proxy |
| `index.html` (edit) | Add a fight-card linking to the new page |

## Import — two sources, merged

### Source 1: Raid-Helper (pre-raid, from desk)

- User pastes a Raid-Helper event link or bare event ID.
- Client calls our proxy `GET /api/raidhelper/:eventId` → server fetches
  `https://raid-helper.dev/api/v2/events/{id}` (public events need no auth;
  direct browser fetch is blocked by CORS, hence the proxy).
- Extracted per signup: display name, class, spec, Discord `userId`.
- Excluded with a notice: Bench / Absence / Late / Tentative signups.
- Unknown/unmappable spec names flag the row for manual correction.
- Provides: expected roster, signup specs, **Discord IDs for @mention pings**.

### Source 2: In-game addon scan (at the instance, raid stacked)

- New `RaidSpecScan` addon, same install/export flow as the existing
  GruulPositions addon.
- `/specscan` starts an inspect queue over the raid: one player at a time
  (game API limit), ~28 yd range, 0.5–2 s per player with retries; progress
  shown ("21/25 scanned"). Works for this guild because the raid stacks
  inside before pulling.
- The addon exports **raw talent point triples**; the web tool infers the
  spec (keeps Lua simple). Export format, one line per player:
  `Name:CLASS:t1/t2/t3` e.g. `Thunderfist:WARRIOR:5/5/51`.
  Players that could not be scanned export as `Name:CLASS:?` and are flagged
  in the tool for manual spec selection.
- Spec inference: highest talent tree wins; ties or near-ties (hybrid builds)
  flag for manual confirmation. Special cases handled by marker talents where
  relevant (e.g. Malediction for CoE preference) are v2 — v1 uses tree only.
- Provides: **actual** class/spec, actual attendance.

### Source 3: Manual add/edit (always available)

Add/edit/remove a player row anytime: name + class dropdown + spec dropdown.
Covers last-minute changes regardless of import source.

### Merging & identity linking

- Both sources imported → merge by name: exact case-insensitive match first,
  then fuzzy (prefix/contains) suggestions.
- Unmatched pairs presented for **manual linking** (two clicks). Links are
  persisted permanently in localStorage keyed by
  `(discordUserId ↔ characterName)`, so subsequent weeks match automatically.
- On conflict, addon data wins for class/spec (it is reality); Raid-Helper
  contributes the Discord ID.
- Mismatches flagged, not auto-resolved: signed X but specced Y; signed but
  not in raid; in raid but never signed.
- Either source alone is fully functional (no pings without Raid-Helper;
  signup specs without the addon).

## Assignment engine

Pure functions in `assignments-engine.js`; input roster + prior manual
overrides, output assignment list. Deterministic. Auto-assign never overwrites
a manual override unless the assigned player left the roster.

### Debuff catalog

Static priority-ordered data structure. Each entry: id, display name, category,
eligible providers (class + spec preference list), exclusivity group, and
whether it is an assigned duty or passive coverage.

Assigned duties (priority order):

| # | Debuff | Provider rule |
|---|---|---|
| 1 | Sunder Armor | Warrior, prefer Protection (tank) |
| 2 | Curse of Elements | Warlock, prefer Affliction |
| 3 | Curse of Recklessness | Next Warlock |
| 4 | Judgement of Wisdom | Paladin (one judgement each) |
| 5 | Judgement of Light | Next Paladin |
| 6 | Judgement of the Crusader | Third Paladin, only if 3+ |
| 7 | Improved Scorch | Fire Mage |
| 8 | Faerie Fire | Druid, prefer Balance |
| 9 | Hunter's Mark | Hunter, prefer Marksmanship |
| 10 | Demoralizing Shout | Warrior; fallback Curse of Weakness via spare Warlock |
| — | Curse of Doom/Agony | Every Warlock without an assigned curse (personal) |

Passive coverage (informational, no action): Misery (Shadow Priest), Shadow
Weaving, Improved Shadow Bolt, Mangle (Feral), Blood Frenzy (Arms), Expose
Weakness (Survival Hunter), Winter's Chill (Frost Mage).

Rules enforced: one curse per warlock, one judgement per paladin, Sunder and
Expose Armor conflict. Debuffs with no eligible player render in an
"uncovered" warning list.

### Cooldowns

- **Innervate**: each Druid gets an Innervate row. Default targets: mages by
  descending priority, with the last Druid reserved as "healer in need"
  (a special non-player target). All targets editable via dropdown.
- **Soulstone**: one row by default (assigned Warlock → target healer,
  prefer Priest). More rows can be added, at most one per Warlock. Editable.

### Crowd control

- Rows keyed by raid-target mark (Moon, Triangle, Square, …).
- Default convention: Moon and Triangle = Polymorph (mages in order),
  Square = Sap (rogue) — all editable; marks can be added/removed.
- v1 default marks: Moon, Triangle, Square; users add more as needed.

## UI (validated via mockup)

Single page, four zones top-to-bottom:

1. **Import** — Raid-Helper link input + Import button, addon-export paste
   area (same tabbed pattern as existing bulk import), manual add button.
2. **Roster** — collapsible strip of class-colored pills
   (`Name · Spec`), click to edit/remove; mismatch and unknown-spec flags
   shown here.
3. **Assignments** — "Auto-assign all" button + three cards (Boss Debuffs,
   Cooldowns, Crowd Control). Every assignment is a dropdown of eligible
   players; warnings inline (red) for uncovered duties; passives shown muted.
4. **Output** — tabs: Discord / Share link / `/raid` macro / Whispers, each
   with a Copy button.

Styling follows existing `style.css` (dark theme, gold accents) and WoW class
colors.

## Outputs

1. **Discord block** — markdown grouped by category (validated in mockup).
   **@mention toggle**: when on, players with a linked Discord ID render as
   `<@userId>` (real pings when pasted); others fall back to plain name.
2. **Share link** — full state serialized (compressed, base64) into the URL
   hash of a read-only view page. No server storage.
3. **/raid macro** — plain chat lines chunked to WoW's 255-char message limit.
4. **Whispers** — one `/w Name <assignment>` line per assigned player.

## Persistence

- localStorage: current roster, assignments, manual overrides, name-link map,
  ping-toggle preference.
- Share links carry a full snapshot; opening one does not overwrite local
  state.

## Error handling

- Raid-Helper fetch fails (bad ID, private event, API down): clear inline
  error; manual + addon paths unaffected.
- Addon paste parse errors: line-level errors shown, valid lines imported.
- Unknown specs / unscanned players: red row flag, excluded from auto-assign
  until fixed.
- Player removed from roster: their assignments return to unassigned and the
  affected duties re-flag.

## Testing

`assignments-engine.test.js` run with plain `node`:

- Full 25-man comp → all duties covered, no double-booking, exclusivity held.
- No-paladin comp → judgements land in uncovered list.
- 4-warlock comp → CoE (Affliction preferred), CoR, remaining locks get
  personal curse.
- Manual override survives re-running auto-assign.
- Spec inference from talent triples incl. `?` and hybrid flags.
- Merge logic: exact, fuzzy, manual link persistence, addon-wins conflict.

## v2 ideas (explicitly not v1)

- Marker-talent detection in the addon (e.g. Malediction, Imp Expose Armor).
- Blessings/buff matrix.
- Per-boss assignment variants.
- Interrupt/dispel rotations.
- **Assignment accountability tracking**: in-game (addon/WeakAura) monitoring
  of actual debuffs present on the boss during combat, compared against the
  assignment sheet, reporting which assigned player's debuff is missing.
