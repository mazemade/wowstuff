# Feedback report v3: gap accounting — every point of the DPS gap has an owner

Date: 2026-09-05. Extends v2 (`2026-09-05-feedback-fair-reference-and-log-selection-design.md`)
and v1 (`2026-09-04-parse-feedback-report-design.md`). Everything not mentioned here stays as
those specify. Section numbers refer to this document.

## 1. Problem

The v2 note lists independent checks (crit low, hit low, flask missing…). Two things are wrong
with that, both shown live on 2026-09-05:

1. **Outcomes are reported as if the player owned them.** Dotwin's Shadow Bolt crit gap on
   Morogrim (32.1% against 45.8%) decomposes into about 1 point of gear, 3–5 points of party
   buffs he cannot give himself, and 8–10 points of sampling luck on a 50-cast fight. "Improve
   your spell crit gear" was wrong advice. The same holds for average hit (spell power from gear,
   from consumables, from party buffs, from raid debuffs, and from ability mix, all folded into
   one number).
2. **Nothing guarantees completeness.** Dotwin's largest controllable loss — 7 Drain Soul
   channels on Vashj, 12 on Kaz'rogal — was never mentioned, because Drain Soul is a "utility
   cast" the rotation rules skip. A list of checks misses whatever nobody wrote a check for.

The gap is a **product** of factors, and it can be accounted for exactly:

```
reference DPS / your DPS = casts factor × damage-per-cast factor × crit factor × fight factor × residual
```

On Dotwin's Morogrim kill (13 Aug): 0.71 × 0.74 × 0.90 ≈ 0.47, matching the observed 1142 vs
2200. Each factor splits into inputs that belong to the **player** (fixable), the **group**
(party buffs, raid debuffs, Bloodlust — an ask), the **raid** (kill speed, phases, deaths — not on
you), or **noise** (luck). When the inputs we can measure do not multiply back to the observed
gap, the remainder is reported as unexplained instead of being silently dropped.

Also verified live: the WCL `characterRankings` board is capped at 2000 rows in every scope
(region and realm both stop at page 20 with `hasMorePages: true`; Dotwin, 19th percentile, is on
neither). v2's "middle of the leaderboard" is therefore the middle of the top 2000 parses, i.e.
a good player, not a median one. That is the right bar for behaviour (rotation, buffs, timing) and
the wrong label. v3 relabels it.

## 2. Data (all already fetched by v1/v2; no new WCL queries)

- Player and reference **Casts** table: counts per ability. **Buffs** table: auras with `bands`
  — channelled spells (Drain Soul, Drain Life, Drain Mana, Health Funnel, Evocation, Arcane
  Missiles, Mind Flay) appear as self-auras with one band per channel, so channel time is the
  sum of band lengths (verified: Drain Soul bands on Dotwin's Vashj and Kaz'rogal kills).
- **DamageDone** table (fight-wide): `activeTime` per player → the player's active share and the
  raid's median active share; for reference players the same fight-wide table gives their raid's
  median. Per-ability rows: `total`, `hitCount`, `critHitCount`, `hitdetails` (Hit, Critical Hit,
  Resisted…).
- **CombatantInfo**: `intellect`, `critSpell`, `hitSpell`, `hasteSpell`, `spellDamage` where WCL
  reports them, gear (item level, gems, enchants), `auras` at pull.
- **Fight context**: duration, deaths, `rankings` roles with per-player `rankPercent`, kill speed.
- **Boss debuffs**: uptime per debuff on the boss (v1 §4.9).
- Reference ranks: durations (the ceiling pages give the fastest kills at the band).

## 3. The accounting (deterministic, module `vet-gap.js`, Node-only, pure functions)

All logs are natural logs. For a pull with a reference: `R = reference.dps / me.amount`,
`G = ln R`. A factor `f` contributes share `ln f / G` (so shares sum to 1 when the factors
multiply to `R`); an input inside a factor gets a share of that factor's share. Every share is
rounded to whole percent and carried on the finding. When `me.amount` or `reference.dps` is
missing or `R ≤ 1`, no accounting is produced (`gap: null`); a player above the reference gets
positives only.

### 3.1 Casts factor

`castsFactor = reference.damagingCastsPerMinute / me.damagingCastsPerMinute`, where damaging casts
are Casts-table entries whose name also appears in the DamageDone table with `total > 0` (this
excludes Life Tap, drains used for mana, healthstones, potions, trinkets — see 3.5 for those).

Inputs, in order:
1. **Raid activity** (raid): `refRaidActive / myRaidActive` — the median active share of the
   player's role group in each raid. Captures phases the reference raid skipped (Lurker's
   submerge) and raid-wide downtime.
2. **Own activity** (player): `(refActive / refRaidActive) / (myActive / myRaidActive)` — how far
   the player sits below their own raid's median, and how far the reference player sits above
   theirs.
3. **Channelled utility time** (player): seconds per minute inside `CHANNEL_UTILITY` auras
   (`Drain Soul`, `Drain Life`, `Drain Mana`, `Health Funnel`, `Evocation`, `Mind Flay` is NOT
   utility for Shadow, `Arcane Missiles` is not utility) — compared as
   `(60 − refChannelSecPerMin) / (60 − myChannelSecPerMin)`.
4. **Cast pacing** (player): the remainder of the casts factor — gaps between casts while active
   (movement, late queuing, latency).

### 3.2 Damage-per-cast factor

`dmgFactor = reference.damagePerDamagingCast / me.damagePerDamagingCast`, with damage per damaging
cast = total damage / damaging casts (this includes ability mix and misses).

Inputs, in order:
1. **Hit** (player): expected miss rate `max(0, HIT_CAP[role] − hitPercent)` where spell hit cap
   is 16% before Misery/Draenei (cap 202 rating / 12.62 per %, `HIT_RATING_PER_PCT`), melee
   hit and expertise per the vetting engine's tables; multiplier `(1 − refMiss)/(1 − myMiss)`.
2. **Raid debuffs** (group): known multipliers on the boss, weighted by uptime:
   `DEBUFF_MULT` — Curse of the Elements 1.10 (shadow, arcane, fire, frost), Shadow Weaving 1.10
   (shadow), Improved Scorch 1.15 (fire), Winter's Chill: +10% crit (frost, goes to 3.3),
   Misery: +5% hit (goes to 3.2.1 as hit), Curse of Recklessness / Sunder Armor / Faerie Fire /
   Expose Armor / Blood Frenzy 1.04 (physical, armour only approximated by the last three). Each
   multiplier `m` with uptime `u` gives `1 + (m − 1)·u`; the input is the ratio of the reference
   fight's product to the player's.
3. **Spell power / attack power** (three inputs sharing one proportional split): the remaining
   factor after 1 and 2 is split in proportion to the *known* power gaps:
   - **from gear** (player): `reference.stats.spellDamage − me.stats.spellDamage` (gear-derived,
     v1 §4.8; attack power for physical);
   - **from consumables** (player): flask / battle elixir / weapon oil / food values from
     `BUFF_VALUES` present at pull for each side;
   - **from party buffs** (group): `BUFF_VALUES` for Wrath of Air Totem, Totem of Wrath (crit
     goes to 3.3), Prayer of Spirit (via Improved Divine Spirit, 40 spell power approximated),
     Eye of the Night, Chain of the Twilight Owl (crit), Fel Intelligence, Arcane Brilliance
     (intellect → crit in 3.3; no spell power), Blessing of Kings (10% of intellect → crit in
     3.3, and nothing here), Battle Shout / Trueshot / Strength of Earth / Unleashed Rage for
     physical.
   The proportional split applies to the *remaining log factor*; if the known gaps sum to zero,
   the whole remainder goes to 4.
4. **Ability mix and unexplained** (player, labelled "rotation"): what is left. Reported with the
   top-3 reference abilities' damage shares next to the player's (v1 §4.3 keeps `ability_unused`,
   `ability_extra`, `ability_ratio` as the concrete lines under it; `ability_extra` now also fires
   for `UTILITY_CAST` names when the reference does not use them and the player does ≥ 1/min).

### 3.3 Crit factor

`critFactor = (1 + refCrit·B) / (1 + myCrit·B)` where `B` is `CRIT_BONUS[spec]` (damage added by a
crit relative to a hit: 1.0 for Destruction (Ruin), Fire and Arcane (Spell Power talent),
Balance (Vengeance), Elemental (Elemental Fury), all melee and ranged; 0.5 otherwise) and the
crit chances are the *measured* crit rates of damaging casts.

The measured chance is decomposed into an **expected** chance from inputs and **luck**:
`expected = base + rating/CRIT_RATING_PER_PCT + int/INT_PER_CRIT[class] + talents + buffs`, with
`base` 1.7 for casters (class table `BASE_CRIT`), `CRIT_RATING_PER_PCT` 22.08, `INT_PER_CRIT`
(warlock 81.9, mage 80, priest 80, druid 80, shaman 80, paladin 80), `talents` from `SPEC_CRIT`
(explicit per spec, crit percent added by talents to the main damaging spells: Destruction 8 —
Devastation 5 + Backlash 3; Affliction 3 — Backlash; Demonology 3 — Backlash; Fire 9 — Critical
Mass 6 + Pyromaniac 3; Arcane 3 — Arcane Instability; Frost 0; Shadow 0; Balance 4 — Focused
Starlight; Elemental 5 — Call of Thunder; Retribution 0; Enhancement 0; Combat 5 — Malice;
Assassination 5 — Malice; Subtlety 5 — Malice; Fury 5 — Cruelty; Arms 5 — Cruelty; Feral 0;
Beast Mastery 0; Marksmanship 5 — Lethal Shots; Survival 5 — Lethal Shots; any other spec 0), `buffs` from `BUFF_VALUES`
(Moonkin Aura 5, Totem of Wrath 3, Chain of the Twilight Owl 2, Arcane Brilliance 40 int → via
INT_PER_CRIT, Blessing of Kings 10% int, Adept's Elixir 24 rating, Brilliant Wizard Oil 14
rating). Inputs, in order:
1. **Crit rating and intellect from gear** (player): expected chance from own rating/int vs the
   reference's.
2. **Consumables** (player): Adept's, oils, food with crit.
3. **Party buffs** (group).
4. **Luck** (noise): `measured − expected` on each side; reported as a share but never as a
   finding ("the rest is luck: your Shadow Bolt crit 32% where your gear and buffs predict 33%").

### 3.4 Fight factor

Not a multiplicative measurement on the player's numbers (raid activity already carries phases);
the fight factor is the **bad-pull** decision (v1 §4.1) with one change: the duration rule
compares against `reference.fastestDurationSec` (the shortest in-band kill on the ceiling pages)
with `T.longFightRatio` unchanged — a raid that took twice the fastest kill saw phases the
reference skipped. A bad pull is excluded from the accounting and listed under "Not on you" with
its reason, including the phase explanation for bosses in `PHASE_BOSSES` (Lurker submerge at
90 s, Vashj phases, Morogrim graves, Kael'thas phases — text table).

### 3.5 Cooldowns and bursts

v2 §6's burst timing stays a finding (player) with a share estimated as
`uses outside Bloodlust × BURST_VALUE[name]` where `BURST_VALUE` is the fraction of a fight's
damage a properly timed burst is worth (0.02 for a trinket, 0.03 for Destruction / Haste Potion),
carried under the damage-per-cast factor's rotation input. `no_potion` likewise (0.03).

### 3.6 Residual

After all factors: `residual = R / (castsFactor × dmgFactor × critFactor)`. Its share is reported
as "unexplained" in the sheet and in the facts table; the model is told it exists and told not to
explain it. A residual share above `T.residualWarn` (25%) is a `Minor` note in the facts table for
the leader ("the measurements do not account for a quarter of the gap on this pull").

### 3.7 Two pulls per boss, several bosses

Shares are averaged over the live pulls where the input applies; an input's finding text uses the
pull where its share is largest (`measuredOn`, v2 rule). The overall ordering is by average share.

## 4. Findings (replaces v1 §4.3–4.8 outcome rules)

Every input with an average share ≥ `T.minShare` (3%) becomes exactly one finding with:
`{ key, owner: 'player' | 'group' | 'raid', share, factor, text, me, reference, unit }`. Outcome
rules `crit_low`, `hit_low`, `resist_high` are removed (their inputs replace them). Kept as
concrete lines under the rotation input: `ability_unused`, `ability_extra`, `ability_ratio`,
`burst_outside_bloodlust`, `no_potion`. Kept as player inputs with shares: `active_low` (own
activity), `channel_time`, `cast_pacing`, `no_flask_or_elixirs` / `wrong_elixir` / `no_food` /
`no_oil` (consumables), `gear_stat` (one per stat in priority order), `gear_enchants`,
`gear_sockets`, `hit_under_cap`. Group: `buffs_missing` (with the buffs' values and share),
`debuff_missing`, `bloodlust_uptime`. Raid: `raid_activity`, bad pulls.

**Stat priority** (`STAT_PRIORITY[spec]`): the order gear-stat findings appear, and the rule that a
stat lower in the list is not reported while a higher one is under its bar. Destruction /
Affliction / Fire / Arcane / Frost / Shadow / Balance / Elemental: hit → spell power → crit →
haste (Affliction and Shadow: hit → spell power → haste → crit). Melee (Combat, Fury, Arms,
Retribution, Enhancement, Feral): hit → expertise → attack power (strength/agility) → crit →
haste. Ranged (hunters): hit → agility/attack power → crit → haste. Bars: hit = the raid's cap
from thresholds; everything else = the reference's gear-derived value.

`positives` keeps its v1/v2 lines and adds "Where you beat comparable players" for any input whose
share is ≤ −3% (the player is ahead).

## 5. The sheet and the note

`facts.gap` per live pull: `{ ratio, factors: { casts, dmg, crit, residual } each { value, share,
inputs: [{ key, owner, share, me, reference, unit }] } }`, and `facts.overall.gap` with the averaged
factor shares. `facts.overall.findings` is the ordered list of §4 (no cap at 6; the note groups
by owner). The reference label everywhere: "players at your item level among the top 2000
parses".

Prompt structure (replaces v1 §5.1 items 2–4):
1. Header as v2.
2. "Where the gap comes from": one sentence per factor with its share, from `overall.gap`, plus
   "the rest is luck / unexplained" when those shares are ≥ 3%.
3. "What you can fix": every `owner: 'player'` finding, biggest share first, each with your
   number, the reference number, its share, one concrete fix.
4. "Ask your raid leader": every `owner: 'group'` finding, with the share.
5. "What's fine": positives.
6. "Not on you": raid findings and bad pulls with reasons.
Under 450 words. "Do not drop any finding" stays. **Completeness guard**: after the number
guard, the server checks that each finding's `me` value (or, for findings without a number, its
`key`'s anchor word from `FINDING_ANCHOR`) appears in the reply; missing ones are appended
verbatim from the finding text under a final line "Also:" rather than rejecting the reply. The
fallback text renders the same six sections.

## 6. Client

Sections render as in v2 (the `<pre>` shows the note). The facts table gains, per pull, a
"Gap" cell: `casts 35% · per cast 40% · crit 13% · unexplained 12%` and the row's tooltip lists
the inputs with owners. "Where you stand" stays.

## 7. Constants (in `vet-gap.js`, exported, tested for shape)

`BUFF_VALUES` (name → { spellPower?, attackPower?, critPct?, critRating?, intellect?, scope:
'party' | 'consumable' }): Flask of Pure Death 80 sp (shadow/fire/frost), Flask of Blinding Light
80 (arcane/holy/nature), Flask of Supreme Power 70, Flask of Mighty Restoration 0, Flask of
Relentless Assault 120 ap, Elixir of Major Shadow Power 55, Elixir of Major Firepower 55, Elixir
of Major Frost Power 55, Adept's Elixir 24 sp + 24 crit rating, Greater Arcane Elixir 35, Elixir
of Major Agility 30 agi + 20 crit rating, Elixir of Major Strength 35 str, Fel Strength Elixir
90 ap, Brilliant Wizard Oil 14 sp + 14 crit rating, Superior Wizard Oil 42 sp, Well Fed 23 sp
(Blackened Basilisk) or 20 agi/str (food is approximated by one value per role), Wrath of Air
Totem 101 sp, Totem of Wrath 3 crit% + 3 hit%, Moonkin Aura 5 crit%, Chain of the Twilight Owl
2 crit%, Eye of the Night 34 sp, Prayer of Spirit 40 sp (Improved Divine Spirit approximation),
Arcane Brilliance 40 int, Blessing of Kings 10% stats, Fel Intelligence 48 int, Battle Shout
305 ap, Trueshot Aura 125 ap, Strength of Earth Totem 86 str, Unleashed Rage 10% ap, Grace of
Air 77 agi, Leader of the Pack 5 crit%, Ferocious Inspiration 3% damage. `DEBUFF_MULT` per §3.2.
`CRIT_BONUS`, `BASE_CRIT`, `CRIT_RATING_PER_PCT`, `INT_PER_CRIT`, `SPEC_CRIT`, `HIT_CAP`,
`HIT_RATING_PER_PCT`, `STAT_PRIORITY`, `CHANNEL_UTILITY`, `PHASE_BOSSES`, `BURST_VALUE`,
`FINDING_ANCHOR`. Values are documented in-file with the wowhead spell id where known; they feed
shares and asks, never a number the player is judged against.

## 8. Testing

- Property tests on `explainGap`: shares of factors sum to 100 ± 1; each factor's input shares sum
  to its share ± 1; `R ≤ 1` gives `gap: null`; missing reference gives null; a reference with no
  stats leaves the power split entirely on "rotation".
- Golden test on the fixture (Rotminster, Anetheron): factor values and shares pinned after the
  coordinator hand-checks the product against `ratio` (the plan carries the arithmetic).
- Synthetic tests: raid-activity vs own-activity split (a raid at 50% median with the player at
  the median gives a raid input only); channel time from bands; hit under cap; debuff uptime
  weighting; consumables vs party split of the power gap; crit expected-vs-luck; stat priority
  ordering (hit under cap hides crit; hit at cap shows crit).
- Findings: every input ≥ 3% becomes exactly one finding; owners set; no outcome keys remain;
  `ability_extra` fires for Drain Soul at 1/min against a reference that never casts it.
- Prompt/guard: the six sections; completeness guard appends a missing finding under "Also:";
  number guard accepts shares.
- Route: unchanged shape plus `facts.gap`; client: headless smoke on Dotwin (Morogrim decomposes
  to casts ≈ 35%, per cast ≈ 40%, crit ≈ 13% within ± 5) and Rotminster.

## 9. Out of scope

- Healers: the accounting needs DPS; healers keep the v2 limited sheet.
- Per-ability spell-power coefficients (the proportional split approximates them).
- Target percentile below the top 2000 (the API cap makes it unreachable).
