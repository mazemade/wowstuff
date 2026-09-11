# TBC evaluation mechanics sources

The role evaluator records what a log establishes. It does not turn a missing cast into a
talent, resource, or avoidable-DPS conclusion. Its catalog covers all 28 TBC class/spec and role
classifications accepted by Warcraft Logs. Spell IDs below are pinned to the local
[wowsims/tbc-new commit 72e0c8a8](https://github.com/wowsims/tbc-new/tree/72e0c8a8feaf62da67add31090666773d6040f69/sim), which is the Culuneta simulator checkout used for this project.

| Area | Telemetry | Primary source |
| --- | --- | --- |
| Hunter | Steady Shot 34120, Serpent Sting 27016, Kill Command 34026, Rapid Fire 3045, Bestial Wrath 19574 | [hunter spells](https://github.com/wowsims/tbc-new/tree/72e0c8a8feaf62da67add31090666773d6040f69/sim/hunter) |
| Rogue | Sinister Strike 26862, Backstab 26863, Slice and Dice 6774, Rupture 26867, Adrenaline Rush 13750 | [rogue spells](https://github.com/wowsims/tbc-new/tree/72e0c8a8feaf62da67add31090666773d6040f69/sim/rogue) |
| Priest | Shadow Word: Pain 25368, Mind Blast 25375, Vampiric Touch 34914 | [priest spells](https://github.com/wowsims/tbc-new/tree/72e0c8a8feaf62da67add31090666773d6040f69/sim/priest) |
| Shaman | Lightning Bolt 25449, Chain Lightning 25442, Flame Shock 25457, Stormstrike 17364, Mana Tide 16190 | [shaman spells](https://github.com/wowsims/tbc-new/tree/72e0c8a8feaf62da67add31090666773d6040f69/sim/shaman) |
| Mage | Arcane Blast 30451, Fireball 27070, Scorch 27074, Frostbolt 27071, Arcane Power 12042, Icy Veins 12472 | [mage spells](https://github.com/wowsims/tbc-new/tree/72e0c8a8feaf62da67add31090666773d6040f69/sim/mage) |
| Warlock | Corruption 27216, Unstable Affliction 30108, Curse of Agony 27218, Immolate 27215, Shadow Bolt 27209 | [warlock spells](https://github.com/wowsims/tbc-new/tree/72e0c8a8feaf62da67add31090666773d6040f69/sim/warlock) |
| Druid | Mangle Cat 33983, Mangle Bear 33987, Rip 27008, Lacerate 33745, Faerie Fire 27011 | [druid spells](https://github.com/wowsims/tbc-new/tree/72e0c8a8feaf62da67add31090666773d6040f69/sim/druid) |
| Warrior | Mortal Strike 30330, Shield Slam 30356, Revenge 30357, Sunder Armor 25225, Shield Block 2565 | [warrior spells](https://github.com/wowsims/tbc-new/tree/72e0c8a8feaf62da67add31090666773d6040f69/sim/warrior) |
| Shared raid debuffs | Hunter's Mark 14325, Sunder Armor 25225, Thunder Clap 25264, Demoralizing Shout 25203 | [core debuffs](https://github.com/wowsims/tbc-new/blob/72e0c8a8feaf62da67add31090666773d6040f69/sim/core/debuffs.go) |

The effect IDs that differ from their cast or talent IDs are also pinned: Improved Scorch uses
target aura 12873 (with WCL's 22959 alias accepted), Unleashed Rage uses aura 30809, and Demonic
Sacrifice uses the pet-specific self auras 18789–18792. Consecration and Totem of Wrath are cast
activity. They do not create a player-attributed target aura from which this evaluator can derive
coverage. The passive Illumination talent was replaced by the observable Divine Illumination
cooldown 31842. See [core debuffs](https://github.com/wowsims/tbc-new/blob/72e0c8a8feaf62da67add31090666773d6040f69/sim/core/debuffs.go),
[core buffs](https://github.com/wowsims/tbc-new/blob/72e0c8a8feaf62da67add31090666773d6040f69/sim/core/buffs.go),
[warlock talents](https://github.com/wowsims/tbc-new/blob/72e0c8a8feaf62da67add31090666773d6040f69/sim/warlock/talents.go), and
[Divine Illumination](https://github.com/wowsims/tbc-new/blob/72e0c8a8feaf62da67add31090666773d6040f69/sim/paladin/divine_illumination.go).

Target effects use outgoing events attributed to the evaluated player. This applies to periodic
damage, Expose Weakness, Improved Scorch, Winter's Chill, Demoralizing Roar, and friendly
Unleashed Rage applications. A buff merely visible on the evaluated player cannot prove that this
player supplied it.

## Healer rank families

WCL records a separate ID for each cast rank. The evaluator therefore accepts every TBC rank of
each ranked healer spell in its checklist:

| Spell | Accepted cast/aura IDs |
| --- | --- |
| Holy Light | 635, 639, 647, 1026, 1042, 3472, 10328, 10329, 25292, 27135, 27136 |
| Flash of Light | 19750, 19939, 19940, 19941, 19942, 19943, 27137 |
| Power Word: Shield | 17, 592, 600, 3747, 6065, 6066, 10898, 10899, 10900, 10901, 25217, 25218 |
| Circle of Healing | 34861, 34863, 34864, 34865, 34866 |
| Renew | 139, 6074, 6075, 6076, 6077, 6078, 10927, 10928, 10929, 25315, 25221, 25222 |
| Chain Heal | 1064, 10622, 10623, 25422, 25423 |
| Earth Shield | 974, 32593, 32594 |
| Rejuvenation | 774, 1058, 1430, 2090, 2091, 3627, 8910, 9839, 9840, 9841, 25299, 26981, 26982 |

The Paladin ranks are implemented in the pinned
[healing source](https://github.com/wowsims/tbc-new/blob/72e0c8a8feaf62da67add31090666773d6040f69/sim/paladin/healing.go).
The remaining rank IDs were checked against the Warcraft Logs classic `gameData.ability` response;
the live capture below independently exercises the ranks actually used on that pull. Renew,
Power Word: Shield, Earth Shield, Lifebloom, and Rejuvenation are friendly-target buffs in WCL
events, so their coverage uses `applybuff`, `refreshbuff`, and `removebuff`. Harmful periodic
effects continue to use the corresponding debuff events. The headline percentage is the union of
time when the effect was active on any recorded target, and is labelled “any-recorded-target
coverage”; per-target HoT rows support assignment review without inventing a primary target.

## Warcraft Logs response semantics verified live

On report `X6mnbPQpGhjJC2TN`, Anetheron fight 38, Guardian `Smellmystaff` (actor 7), the
classic API's `DamageTaken` datatype uses `sourceID` as the affected-player filter: the event
query returned 57 records with `targetID: 7`, while the same query with `targetID: 7` returned
zero. The aggregate table returned three rows / 139,543 damage with `sourceID: 7`, and zero
with `targetID: 7`. Keep `sourceID` for `dataType:DamageTaken`; Debuffs has the same
affected-player convention in this project. Deaths arrives as a table wrapper
`{ data: { entries: [...] } }`, so coaching unwraps it before evaluating death context.

On the same pull, Holy Priest `Sspope` (actor 2) cast Circle of Healing 34866 six times and
Renew 25222 thirteen times. Renew appeared as friendly `applybuff`/`refreshbuff`/`removebuff`
events; generic `applybuff` records also included non-healing procs. Healing target and death-window
counts therefore use positive `heal` and `absorbed` events only. Guardian DamageTaken recorded
139,543 in `total`, including 4,522 absorbed, and 135,021 in `totalReduced`/damage-event `amount`;
the evaluator's DTPS and damage windows consistently use the latter health-damage meaning.

Resource-change events use `targetID` for the affected unit. The same source-filtered hunter
response contains the pet's focus events (`targetID: 51`) alongside the hunter's mana events
(`targetID: 43`). Player resource context filters by target and reports mana, rage, focus, and
energy separately. It does not add unlike resource pools or infer that WCL's `waste` field was
avoidable.

## Retribution comparison regression

The real [Varenthil Winterchill pull](https://classic.warcraftlogs.com/reports/X6mnbPQpGhjJC2TN#fight=14&source=37)
and [Aboujudger comparison](https://classic.warcraftlogs.com/reports/aKWXb2dGT8H1PMDC#fight=9&source=1)
record the Horde Blood aura/damage/Judgement IDs `31892/31893/31898` and Alliance Martyr
IDs `348700/348701/348702`, respectively. Those observed names and effects identify the
faction counterparts. Blizzard describes cross-faction level-70 seal access in its
[Burning Crusade Classic deep dive](https://news.blizzard.com/en-us/article/23625673/world-of-warcraft-burning-crusade-classic-deep-dive).
The newer Martyr IDs do not appear in the pinned WoWSims source and are not attributed to it.

`fixtures/evaluation/varenthil-damage.json` preserves the real comparison's damage rows,
durations and combat stats. The ledger uses the union of damage families, counts hits,
ticks and misses once (crits are already included in hits/ticks), and labels critical rates
as a fraction of landed outcomes. For outcome rate `r` and mean damage `y`, the descriptive
split is `deltaFrequency = (r_ref-r_player)*(y_ref+y_player)/2` and
`deltaYield = (y_ref-y_player)*(r_ref+r_player)/2`. These sum to the observed ability DPS
difference before rounding. They do not isolate execution, gear or buff causality. An
unknown or zero-side mean is not invented to force a split; actor/table residuals stay visible.

The portable Retribution fixture also preserves seal aura bands at individual white-attack
outcomes. Varenthil had Blood on 23/41 outcomes, Command alone on 11, and no recorded
seal on 7; Aboujudger had Martyr on 56/57, Command alone on 1, and no unsealed outcomes.
These include extra attacks and misses; they are neither swing-timer cycles nor guaranteed
seal procs. Missing or malformed seal bands remain unknown. Repeated Command-only
outcomes outside recorded hostile debuffs prompt seal-switch coaching; isolated examples
remain context. The priority threshold (three distinct clean timestamps, at least 10% of
outcomes, and five percentage points behind a known reference) is a coaching heuristic,
not a damage estimate. Mana, positioning and unlogged assignments still require replay
review. No percentage-of-fight Blood uptime target is imposed.


## Investigative coaching evidence, September 2026

- The on-use duration/cooldown catalog in `data/evaluation-on-use.json` is projected from the pinned [item effect database](https://github.com/wowsims/tbc-new/blob/72e0c8a8feaf62da67add31090666773d6040f69/assets/database/db.json). It is used only for an equipped item's observed activation; shared-category locks and pre-pull history are checked before proposing shifted timing.
- [Rogue Mutilate](https://github.com/wowsims/tbc-new/blob/72e0c8a8feaf62da67add31090666773d6040f69/sim/rogue/talents_assassination.go) resolves a parent attempt and two weapon outcomes. The live capture uses 34413 attempts, 34418/34419 hands and rank-two Envenom damage ID 32684. Envenom has no corresponding cast event in these captures. Rank-seven Eviscerate and Expose Armor are 26865 and 26866.
- [Deadly Poison](https://github.com/wowsims/tbc-new/blob/72e0c8a8feaf62da67add31090666773d6040f69/sim/rogue/poisons.go) is a stacking effect. The audit retains source/target, reported stack transitions, refreshes and simultaneous landed Envenom consumption. A natural-expiry finding requires the observed duration; a bare removal is insufficient. Mutilate's poisoned-target multiplier is not used to invent a recoverable DPS total.
- Cold Blood in the real Azgalor capture survives a dodged Envenom and is consumed by the landed retry. This disagrees with the pinned callback on failed outcomes; the observed live sequence wins. A Mutilate conversion requires both hand crits on the same target beside the parent attempt and aura consumption, not any nearby crits.
- [Deathmantle](https://github.com/wowsims/tbc-new/blob/72e0c8a8feaf62da67add31090666773d6040f69/sim/rogue/items.go) proc consumption is compared with finisher attempts; refresh count is not proc count, and an active proc at boss death is not a proven missed use.
- [Druid Rip](https://github.com/wowsims/tbc-new/blob/72e0c8a8feaf62da67add31090666773d6040f69/sim/druid/rip.go) has six two-second ticks in this model. It is distinct from Rogue Rupture's variable combo-point duration. Lacerate stacking is excluded from generic early-refresh advice. [Thunderheart Regalia](https://github.com/wowsims/tbc-new/blob/72e0c8a8feaf62da67add31090666773d6040f69/sim/druid/item_sets.go) adds a Moonfire tick, so Moonfire is not assigned an unconditional base-duration expiry check.
- WCL's [HealingEvent](https://es.classic.warcraftlogs.com/scripting-api-docs/warcraft/interfaces/RpgLogs.HealingEvent.html) defines `amount` as excluding overheal. The coaching engine does not subtract overheal a second time. Player `Debuffs` is never a substitute for raid `DamageTaken`.
- Hyjal control identifiers used by the shared investigator are War Stomp 31480, Fear 31970, Air Burst 32014 and Icebolt 31249. Roots and slows are not treated as an inability to attack a target already in range. Unrecognized gaps remain unresolved. Rain of Fire 31340 is separated from lingering Unquenchable Flames 31341.
# Hunter coaching: source and observation boundaries

- [Pinned Kill Command implementation](https://github.com/wowsims/tbc-new/blob/72e0c8a8feaf62da67add31090666773d6040f69/sim/hunter/kill_command.go): a crit opens/refreshes a five-second opportunity, a cast consumes it, cooldown is five seconds, mana and pet availability constrain use. The evaluator merges refreshed opportunities and observes expiry only after known cooldown readiness; it does not count one lost command per crit.
- [Pinned Bestial Wrath implementation](https://github.com/wowsims/tbc-new/blob/72e0c8a8feaf62da67add31090666773d6040f69/sim/hunter/talents.go): two-minute cooldown and 18-second pet damage aura. Pet death during the aura is merged with pet-survival coaching, never counted as an independent additive damage loss.
- [Pinned Steady Shot implementation](https://github.com/wowsims/tbc-new/blob/72e0c8a8feaf62da67add31090666773d6040f69/sim/hunter/steady_shot.go): casted, mana-consuming ranged damage. Auto/Steady windows are conditional practice; no fixed ratio, avoidable gap duration or extra-cast count is imposed.
- [Recorded source report](https://classic.warcraftlogs.com/reports/NvByqL74tMA3X9Vc): pet death, incoming Rain of Fire/Unquenchable Flames/Doomfire, Revive Pet and next damage are distinct observations. Next positive damage bounds observed recovery rather than establishing the instant the pet could act. Classic source resource snapshots with zero maxima or unsupported type fields are rejected instead of reinterpreted.
