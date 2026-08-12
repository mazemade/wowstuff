# Talent-Aware Assignments — design

**Date:** 2026-08-12
**Status:** approved, ready for an implementation plan

## The problem

Every catalog entry today guesses at talents from talent-tree totals. `Improved Expose Armor` is
assigned to a rogue chosen by `preferSpecs: ['Subtlety', 'Combat']`, but Improved Expose Armor is a
2-point Subtlety talent that most Combat rogues skip. A Combat rogue on that row may be applying
unimproved Expose Armor — 2050 armor, *worse* than a maxed Sunder stack — while the sheet states
the opposite with confidence.

Nine catalog entries rest on a talent the tool cannot see. The spec for this project says spec is a
proxy, never proof; this closes the gap for the four where the proxy is measurably wrong.

## What was proven before designing

A throwaway probe addon (`TalentProbe`, `/tprobe`) was written and run in-game on 2.5.6. Findings:

- `GetTalentInfo(tab, index, isInspect)` **works for inspected raid members** — 19 talents read off
  another player with zero call errors. This was the project's central risk.
- Returns are `[1] name, [2] iconFileID, [3] tier, [4] column, [5] rank, [6] maxRank, …`.
- **An untaken talent returns rank 0 cleanly**, not an error (`Nature's Grasp 0/1`).
- `GetNumTalentTabs()` = 3 and `GetNumTalents(tab)` (21 for druid tab 1) allow deterministic walking.
- Talent **names are localized**. Identification must be coordinate-based, not name-based.

The localization risk is mitigated by the scan being inspection-based: one person runs `/specscan`
and inspects the raid, so only the scanner's client locale matters. Recorded as an assumption.

## Decisions

1. **Two kinds of talent, handled differently.** Where the talent *is* the ability (Improved Scorch,
   Winter's Chill, Hemorrhage, Insect Swarm) a missing talent means the player cannot cast it at all.
   Where the talent *improves* an ability everyone of that class has (Improved Expose Armor, Improved
   Thunder Clap, Improved Demoralizing Shout, Improved Seal of the Crusader) it is a ranking
   preference, not a gate. **Only the second kind is wired up in this project** — `requireSpec` is
   already reliable for the first kind, so converting it would change behaviour that has never been
   observed to fail.
2. **The web tool owns the talent table.** The addon exports every rank positionally and knows
   nothing about what any of them mean. Adding a talent-aware rule later is a web-tool-only change;
   the addon never needs reinstalling for it.
3. **Fixed-position wire fields, empty allowed.** RSS2 nests race inside the subgroup check, so a
   player with no subgroup silently loses their race. RSS3 gives every field its own slot, any of
   which may be empty. This fixes that bug rather than compounding it.
4. **Talent outranks spec.** `preferSpecs` was only ever a proxy for the talent; once the real value
   is available the proxy defers to it. Ordering is talented → unknown → known-untalented.

## Architecture

Four components, each independently testable.

### 1. Addon — `RaidSpecScan` 3.0

A `TalentRanks(isInspect)` function beside the existing `TabPoints`, walking
`GetNumTalentTabs()` × `GetNumTalents(tab)` and emitting one digit per talent, tabs joined by `/`:

```
0000320000000000000/00000000000000000/000000000000000000
```

TBC ranks are 0–5, so one digit each; roughly 70 characters per player, ~2 KB for a 25-man. That is
irrelevant for a copy-paste export frame.

- A rank outside 0–9 (impossible today, but a signature change would produce it) makes the whole
  talent string empty rather than emitting a plausible lie — the same defensive shape `TalentString`
  already uses when it returns `"?"`.
- A player who cannot be inspected keeps today's `"?"` for points and gets no talent segment.
- Export header becomes `RSS3;`. Version bumps to 3.0.

### 2. Wire format — RSS3

Six colon-separated fields; any trailing field may be absent and any field may be empty:

```
Name:CLASS:41/20/0:4:Human:0000320.../.../...
Name:CLASS:41/20/0::Human:0000320.../.../...    no subgroup — race and talents survive
Name:CLASS:41/20/0:4::0000320.../.../...        no race
Name:CLASS:?:4:Human                            un-inspectable — no talent data
```

WoW character names cannot contain `:`, and neither talent points nor talent ranks use `:`, so a
plain `split(':')` yields at most six fields unambiguously.

The parser moves from one nested-optional regex to a split plus per-field validation. Parsing is
positional and version-agnostic: an RSS1 line simply has three fields and an RSS2 line three to five,
so **RSS1 and RSS2 keep parsing with no special-casing**. The pinned RSS1 regression fixture is not
migrated; RSS3 fixtures are added alongside it.

Field validation: `group` is 1–8 or empty; `race` is `[A-Za-z]+` or empty; `talents` matches
`^[0-9]*(\/[0-9]*)*$` or is empty. A malformed field rejects that line with an error, consistent
with existing behaviour.

### 3. Engine — talent table and ranking tier

**`TALENTS`** — a table keyed by class, holding only the talents the catalog consumes. Each entry
records the coordinates, the max rank, and the talent's English name as documentation:

```js
const TALENTS = {
    ROGUE:   { impExposeArmor: { tab: 3, index: 7,  maxRank: 2, name: 'Improved Expose Armor' } },
    WARRIOR: { impThunderClap: { tab: 1, index: 9,  maxRank: 3, name: 'Improved Thunder Clap' },
               impDemoShout:   { tab: 1, index: 12, maxRank: 5, name: 'Improved Demoralizing Shout' } },
    PALADIN: { impSealCrusader:{ tab: 3, index: 10, maxRank: 3, name: 'Improved Seal of the Crusader' } },
};
```

**The `index` values above are placeholders except `PALADIN.impSealCrusader`, which was read directly
off the probe output (`3.10 Improved Seal of the Crusader 3/3`).** The remaining three must be
captured in-game with `/tprobe target <talent name>` and written in before the code is trusted. This
is the one input that cannot be derived on the development machine, and the implementation plan must
treat capturing it as an explicit step rather than an assumption.

**`talentRank(player, key)` → `Number | null`.** The class comes from the player, so it is not a
separate argument. Returns `null` (unknown) when the player has no talent data, when the coordinates
fall outside the parsed ranks, **or when the parsed rank exceeds the recorded `maxRank`** — that last
case is the guard against index drift, and it also pushes a warning so a silently-shifted table is
diagnosable rather than invisible.

**`improvedBy`** — an optional key on whatever catalog object carries `class`. For a single-class
entry that is the entry; for a providers entry it is the individual provider, which is where
`preferSpecs` and `requireSpec` already live. Wired to four rows:

| row | object | talent |
|---|---|---|
| `armor` | rogue provider (`Improved Expose Armor`) | `impExposeArmor` |
| `ap` | warrior provider (`Demoralizing Shout`) | `impDemoShout` |
| `tclap` | the entry | `impThunderClap` |
| `joc` | the entry | `impSealCrusader` |

**`rankPool`** gains a leading tier ahead of `specRank`:

| tier | meaning |
|---|---|
| 0 | talented — sub-sorted by rank descending, so 3/3 beats 2/3 |
| 1 | unknown — no talent data |
| 2 | known-untalented — rank 0 |

Everything after it — `specRank`, duty-count balancing, the name tiebreak — is unchanged and still
runs. A row with no `improvedBy` puts every candidate in the same tier, so its ordering is
byte-identical to today.

Unknown ranking above known-untalented is deliberate: "we don't know" should not lose to "we know
they can't". In practice it rarely fires, because the addon marks an un-inspectable player
`spec-unknown` and `eligible()` already refuses to auto-assign those. It survives only for
Raid-Helper-only signups and manually added players.

### 4. Output — the row explains itself

An `improvedBy` row annotates its assignment so an off-spec pick does not read as a bug:

```
Improved Expose Armor — Stabby (Improved Expose Armor 2/2)
Improved Expose Armor — Stabby (no Improved Expose Armor)
Improved Expose Armor — Stabby (talent unknown)
```

Carried on the duty as a new `qualifier` field, set in `record()` — which already receives both the
resolved entry/provider and the chosen player, so it needs no new plumbing. Only `improvedBy` rows
carry it, at most four. It is distinct from the existing entry-level `caution`, which describes the
duty rather than the assignment.

**Rendered in exactly two places: the Assignments panel and the Discord output.** The `/raid` macro,
the whisper list and the addon export are deliberately unchanged — they are terse and length-bound
(the addon whisper path has a 255-character budget counted in UTF-16 units against WoW's UTF-8
limit), and a raider does not need to know why they were picked, only what to do. The qualifier must
stay ASCII regardless, since `record()` output feeds those paths even when they do not print it.

## Data flow

```
/specscan → inspect each raid member → GetTalentInfo ranks
  → "RSS3;Name:CLASS:pts:group:race:ranks;…"
  → parseAddonExport → player.talentRanks : [[Number]] | null
  → autoAssign → rankPool tier → duty.player + duty.qualifier
  → Assignments panel, Discord output
```

## Testing

- **Engine** — `node assignments-engine.test.js`. New coverage: RSS3 parsing including every
  empty-field permutation; RSS1 and RSS2 still parsing unchanged; `talentRank`'s three return states;
  the `maxRank` drift guard; the three-tier ordering, including a Combat rogue with the talent
  outranking a Subtlety rogue without it; and a no-`improvedBy` row producing byte-identical
  assignments to today.
- **Every new test must be proven falsifiable by mutation** — delete the rule, run the suite, confirm
  it goes red. This branch's dominant defect across six plans has been tests that pass whether or not
  the behaviour exists, and a fixture proven falsifiable in one task was silently neutralised by a
  later task in the same plan. Re-run the key mutations at the end of the plan, not only when each
  test is written.
- **Addon** — `luajit -b RaidSpecScan/RaidSpecScan.lua /dev/null` syntax-checks it. This catches
  syntax only; behaviour still needs a live client.
- **In-game** — capture the three unknown talent coordinates; confirm a real `/specscan` produces an
  `RSS3;` export whose talent digits match the raid's actual talent panes for at least two players of
  different classes; confirm the web tool's assignment changes as expected for a rogue known to lack
  Improved Expose Armor.

## Out of scope

- Converting `scorch`, `wc`, `hemo` and `swarm` from `requireSpec` to a talent gate.
- Any UI for browsing or editing talent data; the grid stays read-only input to ranking.
- Icons, despite `GetTalentInfo` returning a usable fileID.
- The share-link view page, which already omits several newer surfaces.

## Assumptions

- Only the scanner's client locale matters, because scanning is inspection-based. Talent names are
  localized but are used only as documentation in the engine table, never for matching.
- The raid is scanned live with everyone present and in range, so talent data is near-universally
  available and the unknown tier is an edge case rather than a common path.
- Talent `(tab, index)` coordinates are stable for the 2.5.x client this tool targets. The `maxRank`
  guard exists because that assumption could break on a future patch.
