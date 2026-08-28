# Group optimizer v2 — design spec

**Date:** 2026-08-13
**Status:** approved for planning. Supersedes the grouping model of
`2026-08-13-group-optimizer-ai-review-design.md`; grounded in the validated research brief
`2026-08-13-group-optimizer-v2-research-brief.md` (read it first — every decision here traces to a
finding or a ruling recorded there).
**Implementation plan:** `docs/superpowers/plans/2026-08-13-group-optimizer-v2.md`

---

## 1. Objective

Maximise **raid DPS in real units**, subject to floors on tank threat, tank survivability and
healer sustain. Priority when floors cannot all be met: relax healing first, then threat, never
survival. (Max's priority order, interpretation confirmed: floors-plus-one-objective, not
lexicographic DPS-then-threat-then-healing.)

### Score model

```
playerScore(p, group) = BASELINE[specKey(p)] × mult(p) × Π over active buffs b of (1 + v[b][specKey(p)]) ^ count(b)
scoreLayout(layout)   = Σ over groups Σ over players playerScore(p, group)
```

- `specKey(p)` = `CLASS + ':' + spec`, e.g. `'WARRIOR:Fury'`, `'DRUID:Guardian'`.
- `BASELINE[specKey]` = the spec's unbuffed-party sim DPS (provisional hand values first, calibrated
  values after the harness runs). **Healer baselines are 0** — healers contribute to the layout via
  floors, never via the objective. Tank baselines are their real (small) sim DPS.
- `mult(p)` = per-player manual multiplier, default `1.0` (§6).
- `v[b][specKey]` = the buff's fractional throughput value for that spec (e.g. `0.10` = +10% DPS).
- `count(b)` = 1 for every buff except Ferocious Inspiration, where it is the number of BM hunters
  in the group — FI compounds multiplicatively: `(1.03)² = 1.0609`.
- Multiplicative composition is deliberate: it makes the BM-split rule (`split wins iff
  b > 1.03a`) emerge from the score instead of being a special case.

### What is deleted from the v1 score

- The `0.25` cohesion term — an ordinal-units artifact; in DPS units it is a distortion
  (brief §8 Q3). Group readability now comes from the seed, the relabel pass, and deterministic
  enumeration order.
- All ordinal weights. The `w:` tables are replaced by `v` fractions per specKey.

## 2. Floors (feasibility, checked before score)

A layout's `violations` value is the weighted count of floor breaches. Layout A beats layout B iff
`violations(A) < violations(B)`, or equal violations and `score(A) > score(B)`. The weights encode
the relax order (healing before threat, nothing before survival):

| Floor | Rule | Weight |
|---|---|---|
| Survival | Every MT-flagged player's group must contain a shaman | 100 per breach |
| Threat | Every Protection paladin's group must have Wrath of Air as its air choice | 10 per breach |
| Healer sustain | Every group with ≥ 2 healers must contain a shaman (water totem source) | 1 per breach |

- The bear gets no dedicated threat rule. When the bear is MT-flagged, the MT floor (shaman in
  group) guarantees totem support; a twisting melee group then supplies threat *and* dodge buffs
  together. When both ferals are in the roster, pure DPS may seat the **cat** in the melee group
  and the bear with the hunters (Leader of the Pack reaches both groups either way, and the cat's
  higher baseline earns more from the melee buffs) — the brief's "bear goes to the melee group"
  holds only when the bear is the lone feral or Max pins it. Seat-level preferences beyond floors
  are Max's manual calls, same principle as the dry group.
- Floors are expressed as required-provider rules so the UI can say *"Sylvanor is here because the
  tank needs Wrath of Air"* — never as an opaque computed number.

## 3. Buff table v2

### Schema

```js
{ name, element?, mode: 'once' | 'stacks', count: ps => integer, v: { specKey: fraction } }
```

`count` returns how many providers the group has. `mode: 'once'` clamps the effective count to 1
(duplicate providers wasted); `mode: 'stacks'` uses the full count (FI only). `element: 'air'`
rows compete for the one air-totem slot; `element: 'aura'` rows compete for paladin aura slots.

### Air totem selection (per group)

1. Enhancement shaman present → **totem twisting**: Windfury **and** Grace of Air both active
   (Max's ruling; wowsims models it as `totem_twisting`). Wrath of Air stays excluded — twist two,
   not three.
2. Else Elemental shaman present → Wrath of Air pinned (established ruling, tests pin it).
3. Else → argmax of group DPS value across provided air rows; ties keep table order (WF first).

### Paladin aura selection (per group)

Available auras: Devotion, Retribution, Concentration (any paladin); Sanctity (only if a
Retribution paladin is in the group — it is a Ret talent). A group with `k` paladins activates the
top `min(k, available)` auras by group DPS value, deterministic table-order tiebreak. This replaces
the single generic "Paladin aura" row (brief §3 fix #6) without needing an aura-assignment input.

### Row list

| Row | Provider (`count`) | Mode | Notes |
|---|---|---|---|
| Windfury Totem (air) | any shaman | once | absent for enh shaman, ferals, hunters (imbues / forms / ranged) |
| Grace of Air (air) | any shaman | once | |
| Wrath of Air (air) | any shaman | once | `protPaladin` value raised from rounding-error to real (brief §3 fix #4) |
| Strength of Earth | any shaman | once | |
| Totem of Wrath | Elemental shaman | once | |
| Mana Spring Totem | any shaman | once | **new** (brief §3 fix #3); DPS value ~0, exists for the healer floor + note |
| Mana Tide Totem | Resto shaman | once | floor/note relevance only |
| Battle Shout | any warrior | once | |
| Unleashed Rage | Enhancement shaman | once | **now includes hunters** — ranged attacks scale with AP (validation addendum) |
| Leader of the Pack | Feral druid (cat or bear) | once | |
| Ferocious Inspiration | count of BM hunters | **stacks** | the one multiplicative row (brief §3 fix #1) |
| Trueshot Aura | MM hunter | once | |
| Moonkin Aura | Balance druid | once | |
| Vampiric Touch | Shadow priest | once | kept despite being absent from wowsims' proto (brief §4 union finding) |
| Paladin auras ×4 (aura) | paladins, per rules above | once | replaces generic row |
| Heroic Presence | Draenei warrior/paladin/hunter | once | draenei split (brief §3 fix #7): +1% melee/ranged hit |
| Inspiring Presence | Draenei mage/priest/shaman | once | +1% spell hit, casters only |

**Dropped:** Blood Pact (dead in practice — ruling), Tranquil Air (never worth an air slot —
ruling), item party buffs (no gear input channel — ruling, 2026-08-13).

### Draenei swap pass refinement

The v1 pass treats any two draenei in one group as redundant. v2 keys redundancy on **presence
kind**: a Heroic-Presence draenei and an Inspiring-Presence draenei in the same group are both
useful and must not trigger a swap. Mechanics otherwise unchanged (swap-only, anchors off-limits
both sides).

## 4. Weights: provisional now, calibrated later

Two layers, same shape:

1. **Provisional values** (hand-written, shipped first): plausible fractions encoding the same
   *ordering* as v1's ordinals — Windfury 0.10 for WF melee, Totem of Wrath 0.06 uncapped casters,
   FI 0.03 per stack, etc. They make the engine's semantics final while the numbers stay honest
   placeholders.
2. **Calibrated values** (generated): the calibration harness (§7) rewrites the block between
   `// === CALIBRATION START ===` and `// === CALIBRATION END ===` in `assignments-engine.js`
   with sim-derived `BASELINE` and `v` tables plus a provenance header (wowsims commit, encounter,
   iterations, date). No loader changes, no build step, browser and node both keep working.

## 5. Search

- Seeding (roles, shaman spread, anchors-first fill, overflow, draenei swaps) is unchanged apart
  from the presence-kind refinement.
- The hill-climb loses **both** guards (brief §8 Q4): `relocatable()` and the
  under-full-endpoint requirement are deleted. Every cross-group swap and every move into an empty
  seat is a candidate. Candidate comparison is `(violations, score)` lexicographic (§2), single
  best strictly-improving change per iteration, 500-iteration runaway cap, fixed enumeration
  order, first-found ties — determinism is preserved by construction.
- Exact set-partitioning search is **not built** in v2 (Max's ruling: gated on measurement).
  §8's gap measurement decides whether it ever gets a follow-up plan.

## 6. New inputs: MT flag and manual multiplier

- Per-player, persisted in `state.playerMeta = { [name]: { mt: bool, mult: number } }` in the
  existing localStorage `state` (survives reimports; keyed by name like `state.overrides`).
- Applied to roster players as `p.mt` / `p.mult` in the roster-compute step in `assignments.js`.
- UI: a compact "Player tuning" strip in the Groups panel — one row per roster member with an
  `MT` checkbox and a multiplier number input (default 1.0, step 0.05, range 0.5–2.0). No other
  pipeline, no Warcraft Logs integration (brief Phase 3 ruling).
- Engine treats missing fields as `mt: false`, `mult: 1.0` — all existing callers/tests keep
  working without changes.

## 7. Calibration harness (`calibration/`)

Offline; never runs in the app. Node scripts + a pinned checkout of
[wowsims/tbc-new](https://github.com/wowsims/tbc-new) (record the SHA in `calibration/README.md`).

1. **Profiles** — `calibration/profiles/<CLASS>_<Spec>.json`, one `IndividualSimSettings`
   protojson per DPS/tank spec in the guild roster. Captured from the wowsims UI preset (P2/SSC
   gear) via its share link, decoded with `wowsimcli decodelink <link>`. Healer specs have no
   wowsims sim and no profile — their baseline stays 0 by design (§1).
2. **Requests** — `build-requests.mjs` converts each profile to single-player `RaidSimRequest`s:
   a baseline with the canonical fully-buffed `PartyBuffs`/`IndividualBuffs`/`RaidBuffs`
   configuration, plus one request per buff with only that buff toggled off. Single-player + proto
   flags is the correct mechanism — it measures marginal value in realistic context without
   removing provider players (brief §6 Phase 2 method note). Encounter: 180 s single target,
   `iterations: 10000`, `randomSeed: 42`.
3. **Runs** — `run-sims.mjs` shells out to `go run ./cmd/wowsimcli sim --infile … --outfile …`,
   reads `raidMetrics.parties[0].players[0]` for `dps.avg`, `threat.avg`, `dtps.avg` (one run
   yields all three).
4. **Weights** — `make-weights.mjs` computes `v = baseline/without − 1` per (spec, buff), writes
   `calibration/weights.json`, and `inject-weights.mjs` rewrites the engine's calibration block.
   Tank TPS/DTPS deltas go to `calibration/floors-report.md` as the evidence behind §2's floors.
5. **Caveats carried from the brief:** Anniversary-vs-2.5.x divergences beyond Bloodlust are a
   standing review item; BiS profiles overstate spell-hit headroom (Totem of Wrath's hit component
   is worthless at cap — its crit survives); single-toggle marginals can't see WF×GoA interaction.
   Record all three in `calibration/README.md` next to the numbers.

## 8. Verification and output

- **Top-3 output:** `proposeGroups` returns `{ groups, unplaced, score, violations, alternates,
  marginals }`. `alternates` = the two best strictly-worse single-change neighbors of the final
  layout (deterministic), each with its % delta. `marginals[name]` = raid-DPS % cost of moving
  that player to their best alternative seat — rendered in the group cards
  ("moving utopik out of group 1 costs 4.2%"). Keeps the tool an argument, not an oracle.
- **Gap measurement** (`calibration/measure-gap.mjs`): brute-force the true optimum for rosters
  ≤ 11 players (all partitions, variable group sizes ≤ 5 — brief §4 correction) and compare with
  the hill-climb. Gap > ~1% → write a follow-up plan for exact search; otherwise record the
  number and stop (ruling: gated on measurement).
- **Sim verification** (`calibration/sim-verify.mjs`): assemble full-raid `RaidSimRequest`s from
  the profiles for the model's top layouts (real providers, proto buff flags zeroed) and confirm
  the sim's ranking agrees. Disagreement is the trigger to revisit per-player gear inputs
  (brief Phase 3 revisit trigger).

## 9. Test policy (Max's ruling: scoped updates)

The v1 "never modify or delete existing tests" rule stays in force, with exactly these named
exceptions, each requiring a commit-message justification stating which v2 ruling supersedes the
pinned behavior:

1. `proposeGroups: regression — the 2026-08-13 SSC roster` — the Guardian-with-hunters assertion
   contradicts the twisting ruling (bear now belongs with melee).
2. `NOTE_RULES: Blood Pact printed for any warlock group` — pins a dropped buff; the test flips to
   asserting the note is absent.
3. The `A paladin aura` note assertions inside the NOTE_RULES tests — the note now names the
   chosen aura.
4. Any test whose assertion fails *solely* because weights changed units, twisting changed the
   air choice, or the guard removal changed a layout — updated to pin the new intended behavior,
   one justification per test, never deleted.

A test failing for any other reason is a defect to fix in the code, or a decision to surface to
Max — never a test to edit. Per Max's standing instructions: prove every new test can fail, paste
real output, one commit per task, ask before deviating.

## 10. Out of scope

Item party buffs (no gear input), exact set-partitioning search (gated on §8 measurement),
Warcraft Logs integration, drums/professions, healer-throughput sims, encounter-specific layouts,
Bloodlust (raid-wide on Anniversary), Tranquil Air.
