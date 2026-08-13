# Calibration harness

Offline tooling for the group optimizer v2. Nothing here runs in the app: the engine ships a
plain JS table, and these scripts only rewrite it.

Spec: `docs/superpowers/specs/2026-08-13-group-optimizer-v2-design.md`
Plan: `docs/superpowers/plans/2026-08-13-group-optimizer-v2.md`

**Pinned wowsims checkout:** `wowsims/tbc-new` @ `f51cba754c507b69afd642cb3a4978d1356c9617`
**Numbers in the engine:** generated 2026-08-13 from that SHA. `weights.json` and
`floors-report.md` are committed as the evidence behind them.

## Rebuilding from scratch

```bash
cd calibration
git clone --depth 50 https://github.com/wowsims/tbc-new vendor/tbc-new
cd vendor/tbc-new && make proto                              # Go protos are NOT in the repo
go build -tags with_db -o ../wowsimcli ./cmd/wowsimcli        # see the trap below
cd ../..
node extract-presets.mjs                                     # ui/<spec>/presets.ts -> presets.json
(cd dump-profiles && go run .)                               # + phase_2 gear/APLs -> out/profiles
node build-requests.mjs                                      # -> out/requests (396 requests)
node run-sims.mjs --resume                                   # ~35 min; writes out/results.json incrementally
node make-weights.mjs 2026-08-13                             # -> weights.json, floors-report.md
node inject-weights.mjs                                      # rewrites the engine's calibration block
node ../assignments-engine.test.js
```

**The trap:** without `-tags with_db` the binary builds fine and every sim then dies with
`No item with id: 30141`. The item database is embedded behind that build tag
(`sim/core/database_load.go`). Needs `go`, `protobuf`/`protoc` and `protoc-gen-go`.

## Where the profiles come from

Not from the hosted UI's share links, which is what the plan first proposed. A link is
`base64(zlib(protobuf))`, so decoding one correctly depends on the hosted site and this pinned
checkout agreeing about every proto field number — and it needs 17 captures by hand. The
checkout already contains the same gear sets, talents, consumables, professions and APLs the
UI loads, so `extract-presets.mjs` + `dump-profiles/` read them directly. Max ruled this in on
2026-08-13; it is the plan's own documented "hand-assemble from `ui/*/presets.ts` +
`gear_sets/*.gear.json`" fallback, done via the Go helpers so nothing is transcribed except
the Spec-options oneofs (Go types that cannot be expressed as data).

Gear is **phase 2** (SSC/TK) for every spec that has it; warlocks use `t5`.

## Judgement calls baked into the numbers

Each of these changes what the engine believes, so they are listed rather than buried.

1. **Race comes from each spec's Go test fixture, not its UI preset.** Several presets omit
   race, and the Elemental preset is Draenei — which would silently corrupt the Heroic and
   Inspiring Presence marginals, since a Draenei player carries the racial whether or not the
   `PartyBuffs` flag under test is set. None of the test races is Draenei.
2. **Hunters are simmed as turrets, not melee weavers** (Max's ruling). wowsims' shipped hunter
   APL weaves, which makes the hunter auto-attack in melee and genuinely proc Windfury — worth
   +3.1% (BM) and +4.2% (SV), and worth ~15% on the hunter's own DPS. Real, but only
   if your hunters actually weave. With the turret APL (the repo's own `Turret` variant, the
   `Melee weave` APL variable forced false) Windfury measures exactly 0.00% for all hunters,
   matching the engine's long-standing assumption. **Revisit this if the raid starts weaving.**
3. **Negative marginals are clamped to 0** (Max's ruling), and every clamp is printed. A TBC
   party buff cannot reduce your throughput, so `v < 0` is by definition an artifact. All six
   were Windfury Totem on pure casters (−1.3% to −2.2%): wowsims' `WindfuryTotemAura` registers
   a periodic action every 5 seconds regardless of class, which perturbs a caster's cast
   scheduling. Windfury procs off melee auto-attacks and cannot touch a mage. It is systematic,
   not noise — irrelevant buffs like Grace of Air measure exactly 0.00% for the same specs.
4. **Five specs are substituted, not measured.** wowsims models no distinct gear set, talent
   preset or APL for them, and leaving them absent would be worse than a substitution: the
   engine reads `BASELINE[specKey] || 0`, so an unmeasured spec would be rated as contributing
   nothing and parked in the dry group. `make-weights.mjs` prints the list on every run.
   `HUNTER:Marksmanship ← HUNTER:Survival`, `ROGUE:Assassination` and `ROGUE:Subtlety ←
   ROGUE:Combat`, `MAGE:Fire` and `MAGE:Frost ← MAGE:Arcane`. Subtlety is a weaker raid spec
   than Combat, so treating them as equal **overstates** it — sim it properly if one ever joins.
5. **A 0.2% noise floor.** Anything smaller is recorded as absent rather than as a small real
   effect, because a spurious 0.2% is enough to move a layout.
6. **BASELINE and the buff values come from DIFFERENT runs, on purpose.** `BASELINE` is the
   UNBUFFED-party run, because the engine multiplies it back up by whatever the group provides
   — a baseline that already contained party buffs would double-count them. The buff values
   are marginals measured from the FULLY-BUFFED run, because that is the decision the optimizer
   actually makes (Battle Shout and Unleashed Rage are both attack power and have diminishing
   joint value). Getting this wrong is not a harmless constant: each spec's party-buff package
   is worth a different amount, from 1.09x for a shadow priest to 1.55x for a ret paladin, so
   using the fully-buffed number as the baseline inflates melee against casters by ~40%.

## What the measurement changed

| | provisional | measured | note |
|---|---|---|---|
| Windfury / Fury warrior | 0.10 | **0.0974** | the hand value was nearly right |
| Windfury / Combat rogue | 0.10 | **0.0950** | |
| Windfury / Ret paladin | 0.10 | **0.1566** | much larger than assumed |
| Totem of Wrath / Arcane mage | 0.06 | **0.0293** | BiS profiles are hit-capped, so only the crit half survives — the brief predicted exactly this |
| Ferocious Inspiration / Destro | 0.03 | **0.0300** | dead on |
| Battle Shout / Fury warrior | 0.04 | **absent** | a warrior shouts for itself, so a party Battle Shout is worth 0 to it. Correct for a GROUPING model |
| Battle Shout / Combat rogue | 0.04 | **0.0842** | twice the assumption |
| Strength of Earth / BM hunter | absent | **0.0245** | the ordinal table gave hunters nothing |
| Leader of the Pack / feral | 0.05 | **absent** | a feral provides its own; no grouping value |
| Windfury / enh shaman | absent | **0.00** | own imbues — the assumption was exactly right |

## Gap measurement — is exact search worth building?

`node calibration/measure-gap.mjs` brute-forces the true optimum for rosters of ≤ 11 players
(all partitions, variable group sizes ≤ 5) and compares it with the shipped hill-climb.

**With the calibrated weights (2026-08-13) — the run that counts:**

```
enh-melee-hunters-10: exact (v=0) 23429.6 vs climb (v=0) 23411.9 -> gap 0.08%
caster-pally-9:       exact (v=0)  9218.8 vs climb (v=0)  9218.8 -> gap -0.00%
two-full-groups-10:   exact (v=0) 22400.6 vs climb (v=0) 22400.6 -> gap 0.00%
mt-floor-11:          exact (v=0) 13591.7 vs climb (v=0) 13591.7 -> gap 0.00%
```

**Verdict: exact search is NOT warranted. Worst gap 0.08%, far under the ~1% threshold.**
Per Max's ruling this is recorded and the matter stops here — no follow-up plan.

This REVERSES the provisional-weight reading, which is exactly why Max ruled to defer the
decision until calibration landed. For the record, the earlier run said:

```
enh-melee-hunters-10 0.50%   caster-pally-9 -0.00%   two-full-groups-10 0.00%   mt-floor-11 1.81%
```

The 1.81% case was the climb settling at group sizes 4/4/3 where the optimum was 5/5/1. With
measured weights that roster's optimum is reachable by single swaps and the gap closes
completely. The provisional numbers were not merely imprecise, they pointed at a conclusion
(build exact set-partitioning search) that the real numbers do not support.

## Sim verification of the model's ranking

`node calibration/sim-verify.mjs ssc-roster.json 5000` builds the model's chosen layout and its
alternates as FULL raids from real providers — every proto buff flag off, so a group only gets
what the players in it actually bring — and asks whether the sim ranks them the same way.

```
model best                        -> 31975 raid DPS (sim)
alt 1 (utopik <-> Connylloyd)     -> 31963   model -0.02% vs sim -0.04%
alt 2 (utopik <-> Funkell)        -> 31975   model -0.02% vs sim -0.00%

VERDICT: the sim AGREES with the model's ranking (noise allowance 0.3%).
```

Agreement means spec §8's revisit trigger has NOT fired: there is no evidence yet that
per-player gear inputs are needed. Re-run this whenever the weights or the roster change.

**Absolute totals are not comparable, only rankings.** The model reports ~36.7k for this layout
and the sim ~32.0k. The model is a surrogate that multiplies unbuffed baselines by marginals
measured in a fully-buffed context; in a real layout most groups carry only a few of those
buffs, so the reconstruction drifts. Judging the model by its absolute number is a category
error — it exists to order layouts.

## Standing caveats these numbers carry

- wowsims targets TBC Classic 2.5.x. Anniversary's divergences beyond Bloodlust are a standing
  review item — diff them before trusting the numbers wholesale.
- BiS profiles overstate spell-hit headroom. Totem of Wrath's +3% hit is worth nothing at the
  hit cap (its +3% crit survives either way), so its value is overstated for casters who are
  actually capped. This is visible in the table above: 2.93% measured against 6% assumed.
- Single-toggle marginals cannot see interactions: Windfury × Grace of Air is measured as two
  independent deltas. Acceptable error, but it is an error.
- The baseline run has all air totems active simultaneously, which is unphysical in game but
  correct for measuring marginals.
- `totemTwisting` stays false in the requests — the ENGINE models twisting itself, so measuring
  each air totem inside a twist would double-count it.
- Mana Spring and Mana Tide have no DPS value for most specs and keep zero weights; they exist
  in the table for the healer floor and the notes.
- Healer specs have no wowsims sim and no profile. Their baseline is 0 by design (spec §1):
  healers enter the model through floors, never the objective.
