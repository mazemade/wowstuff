# Duration-aware weights + optimizer search fix — findings and design

Research session 2026-08-14/15. All sim numbers from the pinned wowsims checkout
(`calibration/vendor/tbc-new` @ f51cba754c507b69afd642cb3a4978d1356c9617), 10000 iterations,
seed-stable to 0.00pp (verified with seeds 42 and 43).

## Findings (evidence for every decision below)

### F1. The shipped weights were calibrated at the one duration where mana barely matters

`calibration/build-requests.mjs` sims 180s with `shadowPriestDps: 500`. The guild's actual
kill times (WCL zone 1056, Spineshatter EU, 28-day window, pooled across sampled players):

| | |
|---|---|
| Farm bosses (Hydross, Lurker, Leo, FLK, Morogrim, VR, Solarian) | median 2m19s–3m30s per boss |
| Al'ar | ~5m23s |
| Lady Vashj | ~7m45s |
| Kael'thas | ~8m36s |

The distribution is **bimodal**; a single pooled median (~3m24s) misrepresents both halves.

### F2. Mana-buff marginals ramp near-linearly with duration; 180s is the foot of the ramp

Vampiric Touch marginal at SP@500, fully-buffed context (same methodology as calibration):

| Spec | 180s | 200s | 220s | 240s | 265s | 300s | 520s |
|---|---|---|---|---|---|---|---|
| SHAMAN:Elemental | 1.8% | 4.8% | 8.3% | 11.4% | 15.2% | 20.4% | 28.5% |
| DRUID:Balance | 1.7% | 4.3% | 7.4% | 10.5% | 13.5% | 17.8% | 23.5% |
| MAGE:Arcane | 3.7% | 4.0% | 4.7% | 5.3% | 5.8% | 5.6% | 8.9% |
| WARLOCK:Destruction | 1.7% | — | — | — | 2.0% | 2.1% | 2.7% |

Mana Spring / Mana Tide roughly double from 180s to 265s for mana-limited specs. The ramp is
smooth (no cliff), near-linear on [180, 300]. Mechanism: a caster's mana budget (pool + regen
+ pot + rune + class tools) covers ~the first 3 minutes; past that, MP5 converts ~directly
into casts. The class ladder is set by each class's fallback when dry: warlock Life Tap
(≈immune), arcane mage downshifts (gentle), boomkin one Innervate, ele shaman nothing.

### F3. Only mana enters through the buffs — but baselines move too

Full 20-toggle × 15-spec re-measure at 265s vs the shipped 180s table: 17 of ~300 entries
moved >0.5pp. 11 are VT/Mana Spring/Mana Tide; 6 are the known Windfury-on-casters negative
artifact (clamp to 0, calibration README judgement call #3). **Every physical buff is
duration-flat.** Unbuffed baselines of mana-limited specs drop at 265s: Ele −16.3%,
Mage −11.7%, Boomkin −10.5%, Ret paladin −9.1%; melee −0.1% to −4%.

### F4. `shadowPriestDps: 500` halves VT everywhere

wowsims models VT as flat MP5 = 0.25 × `shadowPriestDps` (`sim/core/buffs.go` ~1573). The
model's own Shadow baseline is ~1150–1193 unbuffed. Scaling is sub-linear in SP DPS
(mage 265s: 5.78% @500, 8.61% @800, 9.53% @900, 11.72% @1200), so calibrate AT a realistic
value rather than scaling afterwards.

### F5. Kill durations already ride the existing WCL pull

`encounterRankings` rank objects carry `duration` and `startTime`; `/api/wcl/player` passes
`ranks` through untouched. Median durations need zero new API calls.

### F6. The hill-climb misses 3-cycle-only optima on full rosters

`proposeGroups`' climb enumerates 2-swaps + moves-into-empty-seats. Five full groups have no
empty seats, so optima reachable only by three-way rotation are missed: +0.42% on the
2026-08-14 roster, +0.56% on the `raid25()` test fixture (both confirmed global by 450
random restarts). Blocking mechanism: the profitable 2-swap path breaches the lexicographic
healer floor mid-path; the 3-cycle routes around it. Separately: under a 265s-recalibrated
table the seeded climb landed 0.18% below global on the then-current roster — re-check seed
reachability after recalibration (D8).

### F7. For the 2026-08-14 roster, recalibration ties the current layout to 0.001%

The correction is insurance (respecs, long fights, trustworthy advice surfaces), not a DPS
gain for that specific roster. Had the comp kept an ele + boomkin, the shipped weights would
have mis-parked the shadow priest at a cost of several hundred raid DPS on long fights.

## Design decisions

- **D1. Three calibration anchors: 200s, 300s, 520s.** 200 ≈ farm median, 300 covers the slow
  end of farm + Al'ar-ish, 520 ≈ Vashj/Kael. Piecewise-linear interpolation between anchors,
  clamped outside [200, 520]. Justified by F2's near-linearity.
- **D2. `shadowPriestDps: 1150` at every anchor** (the Shadow unbuffed baseline, which moves
  only −3.4% across durations). No runtime scaling by the actual SP's multiplier — sub-linear
  scaling (F4) makes naive scaling wrong; documented as a known limitation.
- **D3. Engine gets `setEncounterDuration(seconds)`**, which rebuilds `BASELINE` / `BUFF_V`
  **in place** (PARTY_BUFFS captures sub-object references at module init; they must stay
  live). Default 200s on load. Deterministic and idempotent.
- **D4. Duration source: the existing WCL payload.** New `WclMult.rosterKillDurations(...)`
  computes per-boss medians (deduped by `startTime`), splits farm vs long at a 300s per-boss
  threshold, and returns the median-of-boss-medians for each half (equal boss weighting, so
  attendance skew doesn't tilt it).
- **D5. UI: a Fight-length control** in the Player-tuning panel: Farm (default) / Long
  (Vashj–Kael) / Custom seconds. Computed medians shown on the chips after a WCL fetch.
  Stored in `state.wcl`.
- **D6. Optimizer fix: a deterministic 3-cycle escape pass**, run only when no 2-swap/move
  improves. Plus: hoist `groupBuffs` to once-per-group in `scoreLayout` (it is currently
  recomputed per player — ~5× waste, and the 3-cycle pass multiplies the cost).
- **D7. Test correctness rule:** role labels are not unique (two groups can both be
  `casters`); tests must locate groups by provider (`withProvider` pattern already documented
  in the suite), never by `find(g => g.role === ...)`.
- **D8. Acceptance gates after recalibration:** re-run `calibration/measure-gap.mjs` (exact
  vs climb on ≤11-player rosters) and `calibration/sim-verify.mjs` at 200s and 520s. Gap >1%
  or a sim/model ranking disagreement blocks the weights from shipping (same thresholds as
  the 2026-08-13 calibration).
- **D9. The AI second-opinion prompt** learns the configured fight length and the rule that
  mana buffs scale with it, so it cannot repeat the 180s-era intuitions.

## Out of scope (explicitly)

- Per-boss layouts (nobody regroups per boss; Farm/Long toggle covers the real decision).
- Runtime VT scaling by SP multiplier (D2).
- Seed-portfolio search (only if D8's gate fails after recalibration — file a follow-up).
- Healer throughput modeling (baselines stay 0 by design, spec §1 of the v2 design).
