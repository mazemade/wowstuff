# Damage-budget coaching

## Goal

The evaluation must tell a DPS player, in one reading, where their damage falls short of a
comparable player, what causes each part of that gap, what the cause is worth in DPS for their
own build, and what to change. "Points to gear and buffs" is not an answer. The answer names the
item, gem, enchant, consumable, blessing, raid buff, proc, cooldown or execution pattern behind
each part of the gap, says who owns the change, and prices it.

The existing rules stay: no fabricated resource values, no observation upgraded to a fault, no
player-name branches, no sum of overlapping gains. What changes is that every finding must now be
sized and attached to the part of the damage gap it explains, and that the report is ordered by
size.

## What the reader sees

Per boss, in this order:

1. **Damage budget.** "You did 1546 DPS, Jofrey did 1815 over a similar pull. The 268 DPS gap
   sits in: Melee 183, Eviscerate 93, Mutilate −20 (you did more), …" One line per damage family
   with a non-trivial difference, the unallocated residual stated.
2. **Buckets.** Each family with a difference above a threshold opens into its causes. A cause is
   one sentence of observation, one named source, one owner, one price, one action. Example for
   Utopik, Rage Winterchill, Melee:
   - "30 of your 226 swings did no damage (13%) against 15 of 216 (7%)."
     - "15 dodges against 6. You have 0 expertise; Jofrey has 21, all from Fang of Vashj. Your 15
       dodges match the 6.5% a boss dodges with 0 expertise; Jofrey's 6 is below his expected 11,
       so about half of this line is his luck." Source: item. Owner: player (gear). Price: 21
       expertise ≈ N DPS for your build.
     - "13 misses against 6 at 272 hit rating against 252. Your count is above expectation and
       his is below; this line is mostly variance." Source: luck.
   - "Your crits averaged 939, his 1026. At pull you had no flask or battle elixir; Jofrey had
     Flask of Relentless Assault. You had Salvation and Might; Jofrey also had Kings. Jofrey had
     Unleashed Rage 80% of the pull from an enhancement shaman; you had none. Heartrazor procced
     33% against 14%." Sources: consumable (player, priced), blessing (raid, priced), raid buff
     (raid, priced), proc (luck).
   - "95.9 swings a minute against 101.5. Your Slice and Dice uptime was 91% against 82%, so you
     are better there. Jofrey had Dragonspine Trophy active 31% and Drums of Battle 24%. You wore
     Medallion of the Horde, which has no damage stats; you own Bloodlust Brooch and wore it on
     Anetheron." Sources: item (player, priced), raid buff (raid, priced).
3. **Execution findings** already produced by the spec evidence modules (Slice and Dice gaps,
   pet deaths, Kill Command windows, Steady Shot gaps, cooldown timing, consumable timing) appear
   inside the bucket they affect, each with a size. A finding that touches no family (deaths,
   positioning) goes in a final "Whole pull" bucket.
4. **Keep doing, open review and coverage** stay, collapsed, in one section at the end.

The night overview lists the five largest sized items across the night, with their prices and
bosses, and one line per boss with the gap and its largest bucket.

Owner labels: **you** (preparation, gear, execution), **raid** (blessings, raid buffs, drums,
group composition), **luck** (variance within expectation). A raid item is still shown; the player
can ask for it.

The shared recipient page renders the same structure with the same copy.

## Sizing rules

Every cause and finding carries `size`:

- `priced`: a controlled sim of the player's own reconstructed character, baseline against
  baseline plus the stat delta of the source (bonus stats), all else equal. Used for items, gems,
  enchants, consumables, blessings and raid buffs whose stat effect is known. Label carries the
  rotation status: "priced with the validated rotation" or "priced with an unvalidated rotation"
  for specs whose sim route is withheld from absolute-DPS claims (currently Assassination and the
  four routes without a default build). Stat prices are tolerant of rotation error; absolute DPS is
  not, and absolute DPS is never shown from an unvalidated rotation.
- `bound`: an observed-rate upper bound from the player's own log for execution items that no sim
  prices: "up to about 110 DPS on this pull" = the player's own observed rate for the affected
  damage while it was running × seconds it was not running ÷ pull duration. Always "up to". Used
  for pet downtime, ability gaps with a measured duration, missing casts of a maintained buff.
- `unsized`: no defensible price or bound. Shown last within its bucket with "not sized".

Rules:

- Prices and bounds are never added. The bucket's observed difference is the frame; each cause
  states its own value and the bucket says "these overlap and do not sum to the gap".
- A bound is capped at its bucket's observed difference; a capped bound says so.
- Variance is sized as zero. When an observed outcome count sits within two binomial standard
  deviations of its expectation from the recorded ratings, the line says so and is owned by luck.
  Only the expected part of a difference is attributed to a stat.
- Sort within a bucket and across the night by size descending; ties by owner (you before raid).

## Mechanics constants

One module, `evaluation-mechanics.js`, holds every constant with a comment naming the pinned
wowsims file it was read from (commit 72e0c8a8, already pinned in
`docs/evaluation-mechanics-sources.md`). Candidate values, each to be verified against that
checkout before use and flagged in the plan as a mechanics check:

| Constant | Candidate | Verify in |
| --- | --- | --- |
| Hit, haste rating per 1% at 70 | 15.77 | core/stats |
| Crit rating per 1% | 22.08 | core/stats |
| Expertise rating per skill point; dodge and parry reduced per point | 3.94; 0.25% | core/stats, core/attack |
| Boss (level 73) dodge, parry from front, block | 6.5%, 14%, n/a from behind | core/target |
| Boss glancing chance and damage range at 350 skill | 25%; low/high multiplier | core/attack |
| White miss vs boss: single-wield, dual-wield | 9%, 28% | core/attack |
| Yellow (ability) miss vs boss | 9% | core/attack |
| Spell miss vs boss | 17% | core/spell |
| Crit suppression vs boss (melee, ranged, spell) | ? | core/attack, core/spell |
| Ranged glancing | none? | core/attack |
| Attack power per strength, agility by class; crit per agility by class | class tables | class files |

Talents that change these (Precision, Weapon Expertise, Surefooted, Elemental Precision) are
only applied when the recorded talent tree resolves them; otherwise the expectation is shown as a
range and the line says the talent is unknown.

## Attribution: from factor to named source

Each damage family is decomposed from the damage table's hit and miss details into four factors,
each with its own driver set:

| Factor | Computed from | Drivers | Source resolution |
| --- | --- | --- | --- |
| Zero-damage outcomes | miss, dodge, parry, resist counts | hit rating, expertise, spell hit, level | stat snapshot → items, gems, enchants (item DB); auras at pull → consumables, blessings |
| Outcomes per minute | outcome count ÷ duration | haste rating, attack-speed and cast-speed buffs, maintained self-buffs, control, downtime | stat snapshot → items; buff bands → raid buffs, procs, cooldowns; execution findings |
| Damage per landed hit | Hit and Glancing rows | attack or spell power, weapon, target debuffs, damage multipliers | stat snapshot and AP snapshot → items; auras at pull → consumables, blessings; buff bands → raid buffs, procs; debuff table → raid |
| Crit rate | Critical Hit ÷ landed | crit rating, agility or intellect, crit buffs | as above |

Source resolution:

- **Stat snapshot difference** (combatant info at pull) → the item DB (`data/tbc-item-db.json`,
  stat indices as used by `evaluation-sim.js` `statValidation`) resolves which equipped items, gems
  and enchants supply the stat on each side. "All 21 of Jofrey's expertise comes from Fang of
  Vashj." Gem and enchant contributions use the existing gear audit names. A stat difference not
  explained by equipment is attributed to auras at pull.
- **Auras at pull** (combatant info `auras`, with `source` and `ability`) → self-applied entries
  from a consumable catalogue are consumables (owner: you); entries from another actor are
  blessings and party buffs (owner: raid). Missing on the player, present on the reference, is the
  finding. "Raid buff present on neither" is not a finding.
- **Buff bands** for both players → uptime differences above a threshold for a catalogue of
  haste, attack-power and damage buffs, classified as raid buff (Unleashed Rage, Drums,
  Bloodlust/Heroism, Ferocious Inspiration, Trueshot Aura, Windfury), proc (trinket and weapon
  procs, from the equipped item) or cooldown (the player's own). Owner follows the class.
- **Debuffs on the target** from the report's debuff table → Sunder, Faerie Fire, Curse of
  Recklessness, Expose Weakness, Improved Scorch, Misery differences. Owner: raid.
- **Execution findings** from the existing spec modules attach to the family and factor they
  affect by declaring `bucket` and `factor` on the finding.

Unresolved differences stay explicit: "Your crits average 8% lower after the sources above;
weapon damage range and target armor are not compared."

## Architecture

New modules, all pure except pricing:

- `evaluation-mechanics.js` — pinned constants, rating conversions, expected outcome rates and
  binomial variance test.
- `evaluation-budget.js` — extends `analyzeDamage`'s rows into buckets: the four factors per
  family, observed against expected outcomes, and the residual. Replaces the "damage-driver"
  findings in `evaluation-damage-analysis.js`.
- `evaluation-attribution.js` — resolves factor differences to named sources using the item DB,
  aura and buff catalogues, and the debuff table. Emits cause records with `source`, `owner`,
  `statDelta`, `evidence`.
- `evaluation-pricing.js` — prices cause records through the existing sim adapter (bonus-stat
  scenarios, one baseline per fight, bounded count and time) and computes observed-rate bounds
  for execution findings. Records the rotation status. Runs inside the existing background job;
  failure leaves causes `unsized` with the reason.
- `evaluation-coaching.js` — composes buckets, attaches execution findings, sorts by size, builds
  the night overview from sized items.
- `evaluation.js`, `evaluation.css`, shared page — new order and bucket layout; copy plan text
  follows the same order.

Finding contract additions: `bucket` (family id or `pull`), `factor`, `size {kind, dps, label}`,
`sources [{kind, name, owner, statDelta, evidence}]`. Older saved reports without these fields
render under the current layout unchanged.

Item, consumable, aura and debuff catalogues are data files with spell and item ids, no name
matching.

## Acceptance cases

Real captures in `output/` are replayed through the production functions; projected fixtures
under `fixtures/evaluation/` protect the results.

- **Utopik, Rage Winterchill** (rogue): melee bucket 183 of 268; 30/226 against 15/216 zero-damage
  swings; 15 dodges attributed to 0 against 21 expertise from Fang of Vashj with Jofrey's 6 below
  expectation; misses labelled variance; crit average explained by no flask, no Kings, Unleashed
  Rage 80%, Heartrazor 33% against 14%; swing rate explained by Dragonspine Trophy and Drums with
  Slice and Dice noted as better; Medallion of the Horde named with Bloodlust Brooch as the owned
  alternative. Prices labelled "unvalidated rotation". Eviscerate bucket 93 with 0 casts stays an
  execution question, unsized.
- **Utopik, Anetheron**: equal DPS with higher agility and strength must produce the line "you
  matched Mooyootoo's DPS with more stats; the difference is in execution", and the expertise 0
  against 21 with 3 dodged Mutilates in 116 seconds must resolve to a gear action.
- **Funkell, Archimonde** (hunter): pet bucket; pet dead 115.7 of 231.3 seconds; bound "up to"
  from the pet's own 220 DPS while alive; the Kill Command finding sits in the same bucket with a
  smaller bound and sorts below it. Anetheron with no pet death shows the pet family gap 632
  against 930 resolved as far as pet talents, pet gear and Kill Command frequency allow, with the
  unresolved remainder explicit.
- **Culuneta, Anetheron** (fury) and **Varenthil** (retribution): existing execution and damage
  accounting regressions unchanged; their findings now carry buckets and sizes.
- **Healers and tanks**: unchanged report.
- Missing combatant info, missing reference or missing hit details degrade to the current damage
  table with an explicit "not decomposed" line. Missing data never becomes a zero count.

## Non-goals and limits

- No summed total of recoverable DPS. The gap is a frame, not a promise.
- No absolute DPS from an unvalidated rotation.
- No claim that a raid buff was available to the raid leader.
- Target armor, weapon damage ranges and positioning are not compared; the residual says so.
- Healer and tank throughput buckets are out of scope.

## Validation

Unit tests per module with positive and counterexample fixtures: variance within and outside two
standard deviations, item-supplied against aura-supplied stat, self against raid aura, missing
hit details, missing reference, unvalidated rotation labelling, bound capping. Recorded-raid
acceptance test replays the four real captures. Browser test renders the new order on the app and
shared pages and checks the copied plan. Each mechanics constant is verified against the pinned
wowsims file before its test is written, and any that cannot be confirmed is raised for a ruling
rather than assumed.
