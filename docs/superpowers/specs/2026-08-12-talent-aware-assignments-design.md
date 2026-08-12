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
- Talent **names are localized**. Because the scan is inspection-based, only the scanner's client
  locale matters, so name matching is safe here — see Assumptions.

## Decisions

1. **Two kinds of talent, handled differently.** Where the talent *is* the ability (Improved Scorch,
   Winter's Chill, Hemorrhage, Insect Swarm) a missing talent means the player cannot cast it at all.
   Where the talent *improves* an ability everyone of that class has (Improved Expose Armor, Improved
   Thunder Clap, Improved Demoralizing Shout, Improved Seal of the Crusader) it is a ranking
   preference, not a gate. **Only the second kind is wired up in this project** — `requireSpec` is
   already reliable for the first kind, so converting it would change behaviour that has never been
   observed to fail.
2. **The addon matches talents by name.** It carries the short list of talents the catalog cares
   about, finds each by name while scanning, and exports `key=rank` pairs. *(This reverses an
   earlier decision that had the web tool hold hardcoded `(tab, index)` coordinates. Coordinates
   would have needed a one-off in-game capture before the code could be trusted, and would break
   silently if Blizzard ever repatched a tree. Name matching needs neither. The objection to it was
   that the addon must be reinstalled whenever the catalog wants a new talent — but scanning is
   inspection-based, so that is only ever the one person who runs `/specscan`, and they are
   reinstalling for the format bump regardless.)*
3. **Fixed-position wire fields, empty allowed.** RSS2 nests race inside the subgroup check, so a
   player with no subgroup silently loses their race. RSS3 gives every field its own slot, any of
   which may be empty. This fixes that bug rather than compounding it.
4. **Talent outranks spec.** `preferSpecs` was only ever a proxy for the talent; once the real value
   is available the proxy defers to it. Ordering is talented → unknown → known-untalented.

## Architecture

Four components, each independently testable.

### 1. Addon — `RaidSpecScan` 3.0

A `TRACKED_TALENTS` table mapping a stable key to the English talent name, per class, and a
`TalentPairs(class, isInspect)` beside the existing `TabPoints` that walks
`GetNumTalentTabs()` × `GetNumTalents(tab)`, matches names, and emits `key=rank` pairs joined by `,`:

```
impExposeArmor=2
impThunderClap=3,impDemoShout=5
```

Only the tracked talents for that player's class are emitted, so the field is a few dozen characters
at most.

- **Every tracked key for the class is emitted, including at rank 0.** An untaken talent must read
  as `impExposeArmor=0`, never as an omission — otherwise "we know they lack it" is indistinguishable
  from "we have no data", and the whole three-state model collapses.
- **A talent whose name is not found is omitted entirely**, which the web tool reads as unknown.
  That is the honest degradation if a name is ever localized or renamed out from under us.
- A player who cannot be inspected keeps today's `"?"` for points and gets an empty talent field.
- Export header becomes `RSS3;`. Version bumps to 3.0.

### 2. Wire format — RSS3

Six colon-separated fields; any trailing field may be absent and any field may be empty:

```
Name:CLASS:41/20/0:4:Human:impExposeArmor=2
Name:CLASS:41/20/0::Human:impThunderClap=3,impDemoShout=5   no subgroup — race and talents survive
Name:CLASS:41/20/0:4::impExposeArmor=0                      no race; talent known-absent
Name:CLASS:?:4:Human                                        un-inspectable — no talent data
```

WoW character names cannot contain `:`, and neither talent points nor the talent field use `:`, so a
plain `split(':')` yields at most six fields unambiguously.

The parser moves from one nested-optional regex to a split plus per-field validation. Parsing is
positional and version-agnostic: an RSS1 line simply has three fields and an RSS2 line three to five,
so **RSS1 and RSS2 keep parsing with no special-casing**. The pinned RSS1 regression fixture is not
migrated; RSS3 fixtures are added alongside it.

Field validation: `group` is 1–8 or empty; `race` is `[A-Za-z]+` or empty; `talents` matches
`^\w+=\d+(,\w+=\d+)*$` or is empty. A malformed field rejects that line with an error, consistent
with existing behaviour.

### 3. Engine — talent table and ranking tier

**`TALENTS`** — a flat table keyed by the same short key the addon exports, recording which class
owns it, its max rank, and its display name. **No coordinates** — the addon resolved those by name at
scan time:

```js
const TALENTS = {
    impExposeArmor:  { class: 'ROGUE',   maxRank: 2, name: 'Improved Expose Armor' },
    impThunderClap:  { class: 'WARRIOR', maxRank: 3, name: 'Improved Thunder Clap' },
    impDemoShout:    { class: 'WARRIOR', maxRank: 5, name: 'Improved Demoralizing Shout' },
    impSealCrusader: { class: 'PALADIN', maxRank: 3, name: 'Improved Seal of the Crusader' },
};
```

The keys must match the addon's `TRACKED_TALENTS` exactly. That is the one coupling between the two
sides, and it is a plain string rather than a positional guess — a mismatch reads as unknown rather
than as a wrong rank.

**`talentRank(player, key)` → `Number | null`.** The class comes from the player, so it is not a
separate argument. Returns `null` (unknown) when the player has no talent data, when the key is
absent from their data, when the key belongs to a different class, **or when the rank exceeds the
recorded `maxRank`** — that last case guards against the two sides drifting apart, and
`talentDrift(roster)` reports it so a mismatch is diagnosable rather than invisible.

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
  → parseAddonExport → player.talents : { key: Number } | null
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
- **In-game** — confirm a real `/specscan` produces an `RSS3;` export whose `key=rank` pairs match
  the raid's actual talent panes for at least two players of different classes, including one who has
  *not* taken a tracked talent (must read `=0`, not be missing); confirm the web tool's assignment
  changes as expected for a rogue known to lack Improved Expose Armor.

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
- The scanner's client is English, so the addon's English talent names match. This is the assumption
  name matching rests on; it holds because only one person runs `/specscan`. If a non-English client
  ever scans, tracked talents are simply omitted and every affected row reads as unknown — degraded,
  not wrong.
- The `maxRank` guard exists because the addon's `TRACKED_TALENTS` keys and the engine's `TALENTS`
  keys are maintained on opposite sides of the wire and could drift apart.
