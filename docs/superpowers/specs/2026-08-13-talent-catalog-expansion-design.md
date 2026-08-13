# Talent Catalog Expansion — design

**Date:** 2026-08-13
**Status:** approved in chat (owner picked Option A), ready for an implementation plan
**Builds on:** `2026-08-12-talent-aware-assignments-design.md` (shipped: RSS3, `TALENTS`,
`talentRank`, the three-tier `rankPool`, qualifiers)

## The principle

Every spec preference or requirement in the catalog exists **because of a talent**. The previous
plan proved the mechanism on four rows; the owner's ruling for this plan is that it should cover
every talent that decides a real assignment: *"we should know who to assign where/whom depending on
who has what — e.g. Curse of Elements is Affliction because of a certain talent."*

The talents worth tracking are the **cheap, optional ones spec cannot predict** (Malediction,
Kings, Improved Faerie Fire). Deep *signature* talents (Trueshot Aura, Moonkin Form, Mangle) are
implied by the spec inference itself and are explicitly **not** tracked — the owner considered
"truly everything" and cut back to assignment-relevant talents only.

## Scope

15 tracked talents total: the 4 already shipped plus 11 new, across three deliverables:

1. **Six new rankers** — the shipped `improvedBy` mechanism on more rows, plus talent-aware
   paladin ordering in the blessings grid.
2. **Five gates** — a new `requireTalent` mechanism where the talent *is* the spell, including
   Blessing of Kings in the blessings grid.
3. **Cross-provider demotion** — a provider whose best candidate is known-untalented loses the row
   to the next provider.

## The tracked-talent table (engine `TALENTS` / addon `TRACKED_TALENTS`)

Existing four unchanged. New entries:

| key | class | maxRank | English name | drives |
|---|---|---|---|---|
| `malediction` | WARLOCK | 3 | Malediction | `coe` ranker |
| `impFaerieFire` | DRUID | 3 | Improved Faerie Fire | `ff` ranker |
| `feralAggression` | DRUID | 5 | Feral Aggression | `ap` Demo Roar provider ranker |
| `insectSwarm` | DRUID | 1 | Insect Swarm | `swarm` gate |
| `impHuntersMark` | HUNTER | 5 | Improved Hunter's Mark | `hm` ranker |
| `impMight` | PALADIN | 5 | Improved Blessing of Might | blessings-grid ordering |
| `impWisdom` | PALADIN | 2 | Improved Blessing of Wisdom | blessings-grid ordering |
| `kings` | PALADIN | 1 | Blessing of Kings | blessings-grid gate |
| `impScorch` | MAGE | 3 | Improved Scorch | `scorch` gate |
| `wintersChill` | MAGE | 5 | Winter's Chill | `wc` gate |
| `hemorrhage` | ROGUE | 1 | Hemorrhage | `hemo` gate |

**Names and maxRanks are provisional until verified in-game with `/tprobe`.** The failure modes are
safe by construction — a wrong name is silently omitted by the addon and every affected row reads
`talent unknown` (falls back to today's spec-guess); a wrong maxRank makes a legitimate rank read as
unknown and is surfaced by `talentDrift`. Both are visible degradations, not wrong answers. The
in-game checklist (below) closes them.

**Excluded pending an in-game existence check:** `Improved Curse of Weakness`. Whether it exists in
2.5.x changes the `ap` row's −350 arithmetic; the owner's standing rule is that TBC-mechanics
uncertainties are flagged, not resolved from memory. If confirmed, it is one ranker line on the CoW
provider in a later commit.

The addon becomes **3.1**. The RSS3 wire format is unchanged — the talent field simply carries more
pairs (a druid's worst case is three keys, a few dozen characters). One reinstall by the owner. The
Lua↔JS parity test (added by the previous plan's fix wave) asserts key/name/class agreement and its
expected count moves from 4 to 15 — a mismatch on any of the 11 new entries fails the suite.

## Decisions

1. **Unknown always degrades to today's behaviour.** A player with no talent data (Raid-Helper
   signup, manual add, un-inspectable) is treated exactly as the current spec-proxy logic treats
   them: `requireTalent` falls back to `requireSpec`, provider order is preserved, blessings
   ordering falls back to spec order. No surface may get *worse* for a roster with no scan data.
   This generalises the shipped tier rule ("unknown must not lose to known-untalented") to gates
   and providers.

2. **Gates: `requireTalent` on the entry, `requireSpec` retained as the unknown-fallback.**
   Semantics in `eligible()` (extracted as a shared `canCast(p, entry)` so `applicableWhen` can use
   the same truth):
   - rank > 0 → can cast, **regardless of inferred spec** (a "Fire" mage by tree totals who took
     Winter's Chill is a legal WC caster; tab totals were always a guess)
   - rank 0 → cannot cast, hard no
   - null → fall back to the existing `requireSpec` check
   Wired to `scorch`, `wc`, `hemo`, `swarm`. `hemo`'s `applicableWhen` (and its notApplicable/missing
   split) moves onto `canCast` so the gate and the warning can never disagree.

3. **`joc` deliberately keeps its shipped shape** (`requireSpec: 'Retribution'` +
   `improvedBy: 'impSealCrusader'`) rather than converting to a gate. Converting would let a Holy
   paladin with 3/3 ISC take the row and stop an untalented Ret from taking it — defensible, but it
   changes an owner-ruled row (decision 5 of the branch ledger) without being asked. Flagged as a
   considered alternative, not done.

4. **Blessings grid, Kings gate:** the auto-fill currently hands `BLESSING_PLANS[0]` (Greater Kings
   raid-wide) to whichever paladin sorts first by spec. New: plans are matched to paladins
   talent-aware. The Kings plan goes to a paladin who *can* cast it — talented first, unknown second,
   known-0 excluded; ties broken by the existing `PALADIN_ORDER` then name, so a roster with no
   talent data reproduces today's assignment exactly. If every paladin is known-0, the grid keeps
   today's layout minus Kings and warns: `Nobody can cast Blessing of Kings — it is a Protection
   talent.` A **manually assigned** cell is never blocked (respecs happen, the lead may know better),
   but a known-0 Kings cell draws a warning in the same list the duplicate-blessing warning uses.

5. **Blessings grid, Might/Wisdom ordering:** the Might/Wisdom plan row goes to the remaining
   paladin whose `impMight`/`impWisdom` tier is best (talented in either > unknown > known-0 in
   both), ties by the existing order. The per-class Might-vs-Wisdom split inside the row is
   unchanged — matching individual classes to the better-talented paladin would need per-cell
   assignment, which is deliberately out of scope (YAGNI; the grid is editable).

6. **Cross-provider demotion:** in the provider loop, a provider is demoted **only when its best
   eligible candidate is known-untalented (tier 2)** for that provider's `improvedBy`. Non-demoted
   providers keep catalog order; demoted providers are tried after them, still in catalog order; a
   demoted provider with the only candidates still beats an empty row. Unknown (tier 1) does **not**
   demote — decision 1. Concretely: a lone rogue with `impExposeArmor=0` loses `armor` to an
   available Protection warrior's Sunder; the same rogue with no scan data keeps the row exactly as
   today. The chosen provider's qualifier explains the pick as shipped.

7. **Rankers are exactly the shipped mechanism.** `improvedBy: 'malediction'` on the `coe` entry,
   `impFaerieFire` on `ff`, `feralAggression` on the Demoralizing Roar provider, `impHuntersMark`
   on `hm`. Qualifiers appear on these rows automatically via the existing `record()` logic —
   no new rendering work.

## What this deliberately does not do

- **Passives panel and group notes stay spec-derived.** The talents they rely on are 31-point
  signature picks where spec is a near-perfect proxy; tracking them re-confirms what inference
  already knows. The two genuinely weak proxies (Blood Frenzy, Expose Weakness — tier-9 talents a
  33-point build lacks) are noted as a cheap future addition, not included.
- **Group composition is untouched.** Talent data changes no grouping decision; talent-aware
  placement rules (e.g. Trueshot hunter with physical DPS) would be a separate, rules-first design.
- No UI for browsing talent data; the grid and rows stay as they render today plus warnings and
  qualifiers.
- The share-link view page, unchanged as before.
- `minClassCount` (known dead code) is not touched.

## Testing

- `node assignments-engine.test.js`; baseline at plan start **173 passed, 0 failed**. Every count
  in the plan states the delta and the rule, not just the absolute — the previous plan's fixed
  numbers went stale twice.
- **Every new test proven falsifiable by mutation** — delete the rule on a scratch copy, run, paste
  the real failure, restore. Re-run the key mutations at plan end; coverage is not a one-time
  property on this branch.
- Gates: each of the four rows tested in all three states (talented → assigned even off-spec;
  known-0 → not assigned even on-spec; unknown → identical to today). The unknown case is pinned
  against the *current* behaviour, not a new one.
- Kings: talented-beats-unknown-beats-excluded ordering; the all-known-0 warning; the manual-cell
  warning; a no-talent-data roster reproducing today's grid byte-identically.
- Cross-provider: the rogue-0 → Sunder case; unknown preserving today's order; all-providers-
  demoted still filling the row; the `ap` four-provider chain with the curse exclusivity group.
- Lua parity test count 4 → 15; addon syntax via `luajit -b`; behaviour via the stubbed-globals
  harness pattern from the previous plan (rank-0 emitted, unfound omitted, per-class fields).
- Browser (CDP, `.superpowers/tools/`): blessings grid with a known-0-Kings paladin; a gate row
  flipping between the three states from an edited RSS3 import.

## In-game verification (owner, after install)

1. `/tprobe`-check the 11 new names and max ranks against real talent panes — one player per class
   is enough; a name mismatch shows up as a permanently-unknown row.
2. Confirm whether **Improved Curse of Weakness** exists in 2.5.x, and its effect, before the CoW
   ranker is added.
3. A paladin without the Kings talent: grid refuses to auto-assign them Greater Kings and the
   warning reads correctly.
4. The existing RSS3 checklist in BRANCH-STATE §5 still applies to the 3.1 reinstall.

## Assumptions

- Only the scanner's (English) client locale matters — unchanged from the shipped design.
- The blessings grid's four-plan structure and owner rulings (Salvation withheld from tank-holding
  classes, four-blessing set, fourth-paladin empty row) all stand; this design only changes *which
  paladin gets which plan* and adds warnings.
- `talentTier`-style ordering constants are reused, not redefined, so gates/providers/blessings
  cannot drift from `rankPool`'s notion of talented/unknown/untalented.
