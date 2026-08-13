# Calibration harness

Offline tooling for the group optimizer v2. Nothing here runs in the app: the engine ships a
plain JS table, and these scripts only rewrite it.

Spec: `docs/superpowers/specs/2026-08-13-group-optimizer-v2-design.md`
Plan: `docs/superpowers/plans/2026-08-13-group-optimizer-v2.md`

## Status

| Piece | State |
|---|---|
| `measure-gap.mjs` — hill-climb vs exact optimum | **done** (see below) |
| wowsims checkout + `wowsimcli` | **not built** — no Go toolchain on this machine |
| `profiles/*.json` | **not captured** — needs share links from the hosted wowsims UI |
| `weights.json`, `floors-report.md` | **not generated** |
| Engine calibration block | still the **provisional hand values** from spec §4 layer 1 |

The engine's `BASELINE` / `BUFF_V` block therefore still holds hand-written placeholder
numbers. They encode the intended *ordering* and plausible magnitudes, and they make the
engine's semantics final — but no number below the `=== CALIBRATION START ===` marker is
sim-derived yet. Treat the layout score as ordinal until that changes.

## Gap measurement (2026-08-13, PROVISIONAL weights)

`node calibration/measure-gap.mjs` brute-forces the true optimum for rosters of ≤ 11 players
(all partitions, variable group sizes ≤ 5) and compares it with the shipped hill-climb.

```
enh-melee-hunters-10: exact (v=0) 10584.2 vs climb (v=0) 10531.7 -> gap 0.50%
caster-pally-9:       exact (v=0)  5925.9 vs climb (v=0)  5925.9 -> gap -0.00%
two-full-groups-10:   exact (v=0) 10519.9 vs climb (v=0) 10519.9 -> gap 0.00%
mt-floor-11:          exact (v=0)  5082.0 vs climb (v=0)  4990.1 -> gap 1.81%
```

**Verdict: exact search IS warranted on this evidence — the worst gap is 1.81%, above the
~1% threshold Max set.** Per the ruling, that calls for a follow-up plan, not an
implementation in this plan. Two caveats before acting on it:

1. **These are provisional weights.** The gap must be re-measured after the calibration
   pipeline runs. It is a measurement of the search, but the search is over a surrogate
   whose numbers are still placeholders.
2. **The failure mode is legible, and may be cheaper to fix than exact search.** On
   `mt-floor-11` the climb settles at group sizes 4/4/3 while the optimum is 5/5/1. Brief §5
   correction 3 predicted exactly this: party buffs do not dilute with group size, so buffed
   groups should be as FULL as possible and empty seats concentrated. A single-swap /
   single-move climb cannot always reach that shape, because the intermediate steps are not
   individually improving. A cheaper follow-up than full set partitioning would be a
   seat-concentration pass, or admitting 2-player compound moves. Worth measuring before
   committing to the big build.

## Standing caveats for the numbers (spec §7.5), to record next to them once generated

- wowsims targets TBC Classic 2.5.x. Anniversary's divergences beyond Bloodlust are a
  standing review item — diff them before trusting the numbers wholesale.
- BiS profiles overstate spell-hit headroom. Totem of Wrath's +3% hit is worth nothing at
  the hit cap (its +3% crit survives either way), so its value is overstated for casters
  who are actually capped.
- Single-toggle marginals cannot see interactions: Windfury × Grace of Air is measured as
  two independent deltas. Acceptable error, but it is an error.
- The baseline run has all air totems active simultaneously, which is unphysical in game
  but correct for measuring marginals.
- `totemTwisting` stays false in the profiles — the engine models twisting itself, so the
  per-totem marginals must be measured untwisted or they would double-count.
- Mana Spring and Mana Tide have no DPS sim and keep zero weights by design. They exist in
  the table for the healer floor and the notes.
- Healer specs have no wowsims sim and no profile. Their baseline is 0 by design (spec §1):
  healers enter the model through floors, never the objective.
