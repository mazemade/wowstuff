# Parse feedback report — design

**Date:** 2026-09-04
**Status:** Approved design, awaiting implementation plan
**Builds on:** `docs/superpowers/specs/2026-09-03-player-vetting-design.md`

## 1. Problem

The vetting page says *that* a player's median parse is under the gate. It cannot say *why*,
and the raid leader cannot tell the player anything useful beyond "your parses are low". The
leader wants, per player, a short report they can paste to the player: what is holding their
damage back, in order of impact, with the evidence and a concrete fix for each point, plus what
is fine and what was not the player's fault.

Worked example that drove the design (probed live 2026-09-04, Spineshatter-EU): Rotminster, a
Destruction warlock at item level 124, median parse 14 across four Black Temple / Hyjal kills at
percentiles 14, 10, 32 and 0.3.

- The 0.3 on Kaz'rogal was an 1131-second pull (top parses are ~93 s) on which all nineteen
  DPS in the raid parsed 0 and three players died. It is a raid-wide bad pull, not evidence
  about the player, and it drags the median down.
- On Anetheron (32) the player was active 92% of the fight and landed 43 Shadow Bolts in 131 s,
  the same cast rate as the top EU Destruction parse (38 in 87 s). The difference was per bolt:
  non-crit hit 3087 vs 4469, crit rate 26% vs 55%, average 3782 vs 6638. Same 0/21/40 talents.
  Same-item-level Destruction warlocks on that boss do ~2600 DPS; the player did 1301. At the
  pull the player had Elixir of Draenic Wisdom (a mana elixir), Major Shadow Power and food; the
  reference had Moonkin Aura, Blood Pact and Prayer of Spirit in their group, which the player's
  group lacked. The player also cast Immolate five times on a Shadow Bolt build.

A report that states those points, in that order, with those fixes, is the deliverable.

## 2. Data sources (all verified live 2026-09-04)

Everything comes from the WCL v2 classic API the server already authenticates against, plus
the OpenAI key already used by `/api/ai-review`.

### 2.1 Per-kill identity

`characterData.character(...).encounterRankings(encounterID, metric)` returns `ranks[]`, one
per kill, with `report { code, fightID }`, `rankPercent`, `duration`, `amount`, `bracketData`
(item level), `spec`. One query with one alias per killed encounter (the encounter list comes
from the `zoneRankings` blob the vetting profile already holds).

### 2.2 Fight context (one query per kill)

```graphql
query($c:String!,$f:[Int]!){reportData{report(code:$c){
  masterData{actors(type:"Player"){id name subType}}
  fights(fightIDs:$f){id name startTime endTime kill}
  rankings(fightIDs:$f)
  dmgAll:table(dataType:DamageDone,fightIDs:$f)
  deaths:table(dataType:Deaths,fightIDs:$f)
  debuffs:table(dataType:Debuffs,fightIDs:$f,hostilityType:Enemies)
}}}
```

- `rankings` (JSON scalar): `data[0]` has `duration`, `deaths`, `bracketData`,
  `speed { rankPercent }`, `execution { rankPercent }`, and `roles.dps.characters[]` with
  `name`, `amount`, `rankPercent` for every DPS in the raid. `roles.healers` likewise.
- `dmgAll.data.entries[]` (fight-wide): per player `name`, `type`, `total`, `activeTime`,
  `activeTimeReduced`, `itemLevel`, `talents`, `gear`. `data.totalTime` is the fight length.
  Active time is read from here; the per-player (sourceID-scoped) tables do not carry it.
- `deaths.data.entries[]`: `name`, `timestamp`, `killingBlow { name }`.
- `debuffs.data.auras[]`: every debuff on enemies during the fight with `name`, `guid`,
  `totalUptime`; `data.totalTime`. Verified on the Anetheron pull: Curse of the Elements 91%,
  Curse of Recklessness 92%, no Misery, Shadow Weaving or Fire Vulnerability present.
- `dmgAll` entries' `gear[]` has the same shape as the CombatantInfo gear the vetting profile
  already summarises (`id`, `slot`, `quality`, `itemLevel`, `permanentEnchant`, `gems[{id}]`,
  `setID`), so `VetEngine.summarizeGear` applies to reference players with no extra query.

### 2.3 Player tables (one query per kill)

```graphql
query($c:String!,$f:[Int]!,$s:Int!){reportData{report(code:$c){
  dmg:table(dataType:DamageDone,fightIDs:$f,sourceID:$s)
  casts:table(dataType:Casts,fightIDs:$f,sourceID:$s)
  buffs:table(dataType:Buffs,fightIDs:$f,sourceID:$s)
  ci:events(dataType:CombatantInfo,fightIDs:$f,sourceID:$s,limit:5){data}
}}}
```

- `dmg.data.entries[]` per ability: `name`, `total`, `hitCount`, `critHitCount`, `missCount`,
  `tickCount`, and `hitdetails[] { type, count, total }` where `type` is one of `Hit`,
  `Critical Hit`, `Resisted Hit`, `Resisted Critical Hit` (partial resists), `Miss`, …
- `casts.data.entries[]` per ability: `name`, `total` (cast count).
- `buffs.data.auras[]`: `name`, `totalUptime`, `totalUses`; `data.totalTime`.
- `ci.data[0].auras[]`: `name` of every buff at the pull (flask/elixirs, food, class buffs).
  Healers' `ci` may be empty for fights logged without combatant info; then consumables are
  "unknown", not "missing".
- The same `Summary` table gives `playerDetails.dps[].potionUse` and `healthstoneUse`; the
  design reads `potionUse` from a `summary:table(dataType:Summary,fightIDs:$f)` field added to
  the fight-context query.

### 2.4 Reference players

`worldData.encounter(id).characterRankings(metric:dps, className, specName, serverRegion,
page)` returns 100 ranks per page with `name`, `amount`, `duration`, `bracketData`,
`report { code, fightID }`. There is no item-level filter argument (`bracket:` is rejected
with "Invalid bracket specified"), so the band is selected client-side by paging: pages 1..5
of the EU rankings for Anetheron held 121 Destruction warlocks at item level 123–125.

`className` is the WCL class name ("Warlock"); `specName` is the WCL spec name as in the
vetting profile's `bestSpec` ("Destruction", "BeastMastery", …). The existing
`normalizeWclSpec` mapping is reused in reverse.

### 2.5 Cost

Measured against `rateLimitData`: a report-scoped table bundle costs ~7 points, a masterData +
fights + rankings query ~3, a rankings page ~1. Budget is 3600 points per hour per client.

| Piece | Points |
|---|---|
| Player, per kill (2.2 + 2.3) | ~10 |
| Reference, per boss, first time (up to 5 ranking pages + 3 players' tables) | ~35 |
| One player, 4 kills, references cold | ~180 |
| One player, 4 kills, references warm | ~40 |

The reference cache (§3.4) makes the roster-wide case cheap: every player of a spec shares
the same reference per boss.

## 3. Architecture

```
vetting.js / vetting.css                  "Feedback report" button in the detail panel, report
                                          box with Copy, collapsible facts sheet
vet-feedback.js (+ vet-feedback.test.js)  Node-only: gathers WCL data, derives the facts
                                          sheet, builds the prompt
server.js  GET /api/vet/feedback          orchestration, caches, OpenAI call
fixtures/wcl-feedback-rotminster.json     captured 2026-09-04 probe: player + reference tables
```

Approach: **the server measures, the model writes.** Every number in the report is measured
by `vet-feedback.js` into a facts sheet; the model turns the facts sheet into player-facing
prose under a prompt that forbids inventing figures. The facts sheet is returned alongside the
prose and shown under it so the leader can check any claim before sending.

### 3.1 Route

`GET /api/vet/feedback?name&server&region&zone`

Validation and error mapping mirror `/api/vet/player` (`wclErrorResponse`). Steps:

1. Get the vetting profile via the same code path as `/api/vet/player` (cache hit in the
   common case). No parses in either tier → 404 `"No parses to analyse"`. Gear findings
   (§4.6) come from this profile.
2. Take the gating tier's killed encounters (`profile.parses.bosses` with `kills > 0`), lowest
   `medianPercent` first, at most **8**. Query `encounterRankings` for them (one query, aliased)
   and, for each encounter, pick the rank most representative of the `medianPercent` that got the
   boss selected — not the most recent rank (`pickRank`, task-rep-kill, 2026-09-05). The boss was
   flagged by its median across every kill; the most recent kill can sit at a completely different
   percentile once a player has more than one kill on a boss, so the numbers that flagged the
   player and the numbers explaining them would describe different events. Recency also loses
   whole bosses outright: a bad pull contributes nothing to the median (§4.1) but is a real rank,
   so a boss whose most recent kill happens to be a bad pull would vanish from the report even
   when the player has other, clean kills on it. Rules, in order: demote (but do not exclude) a
   rank whose duration is more than `T.longFightRatio` times the shortest duration on that boss, as
   a likely raid-wide bad pull; among what remains, pick the rank whose `rankPercent` is closest to
   `medianPercent`, falling back to the most recent rank when `medianPercent` is null or no rank
   has a `rankPercent`; break ties toward the more recent kill. On the current roster, where every
   player has exactly one kill per boss, this is a no-op — the value is for later in the tier, once
   kills accumulate.
3. For each kill, run the fight-context and player-table queries (§2.2, §2.3), three kills in
   flight at a time.
4. For each encounter, get the reference (§3.4).
5. Derive the facts sheet (§4).
6. Ask the model for the report (§5). A model failure (no key, upstream error, timeout) does
   **not** fail the request: the response carries `report: null` and `reportError`, and the
   page shows the facts sheet alone.
7. Return `{ facts, report, reportError, generatedAt }`. Cache per
   `region/server/name/zone` for 15 minutes, same sweep pattern as `vetCache`.

Healers (`profile.parses.metric === 'hps'`) get a reduced report: fight context, deaths,
active time, consumables and gear, no per-cast comparison and no reference. `facts.limited`
says so and the prompt is told.

### 3.2 Concurrency and rate limits

A 429 from WCL anywhere in the pipeline aborts the request with 429; the page's existing pause
and retry handle it. In-flight reference fetches for the same key are shared
(one promise per cache key) so two leaders clicking the same spec do not both pay.

### 3.3 Facts sheet

```
{
  player: { name, class, spec, role, itemLevel, talentSplit, metric },
  tier: { zone, zoneName, medianPercent, threshold },
  gear: { gearScore, avgItemLevel, missingEnchants: [slot…], emptySockets,
          hit: { value, cap, short } | null, defense: {...} | null },   // from the profile
  kills: [ {
    encounterId, name, rankPercent, date, reportCode, fightId, wclUrl,
    fight: { durationSec, referenceDurationSec, raidDeaths, raidSpeedPercent,
             raidExecutionPercent, raidDpsCount, raidDpsRank, raidDpsMedianPercent,
             badPull: bool, badPullReason: string|null },
    debuffs: { present: [ { name, uptimePercent } ], missing: [name…] },   // metric-relevant raid debuffs
    me: { dps, activePercent, died: { atSec, by } | null, potionUse, healthstoneUse,
          stats: { spellDamage, healing, attackPower, rangedAttackPower, spellCrit, meleeCrit,
                   spellHit, meleeHit, haste, avgItemLevel, gearScore },
          consumablesAtPull: [name…], buffsAtPull: [name…],
          castsPerMinute, casts: { ability: count },
          abilities: [ { name, share, avgHit, avgCrit, critPercent, resistPercent } ] },
    reference: { itemLevelBand: [lo, hi], sampleSize, dps, durationSec, activePercent,
                 stats: { same shape, medians over the 3 reference players },
                 castsPerMinute, casts: { ability: count },
                 abilities: [ same shape ], consumablesAtPull: [name…],
                 buffsAtPull: [name…] } | null,
    findings: [ { key, severity: 'major'|'minor'|'info', text } ]
  } ],
  overall: { badPullCount, findings: [ same shape, merged and ranked ] },
  limited: bool
}
```

`wclUrl` is `https://classic.warcraftlogs.com/reports/<code>#fight=<id>&source=<sourceId>`
so the report can link straight to the fight.

**Deviations from the shape above** (Minor 21, whole-branch review, recorded 2026-09-05 so the
document and the code agree):

- `fight.raidDpsCount/raidDpsRank/raidDpsMedianPercent` became `raidGroupCount/raidGroupRank/
  raidGroupMedianPercent`, because the player's own row is ranked among their actual role group
  (dps/healers/tanks), not always "dps".
- `me.stats.haste` became `spellHaste`/`meleeHaste` (and `me.stats.rangedCrit` was added) — the
  two haste ratings are not interchangeable and the profile already keeps them separate.
- `gear.hit`/`gear.defense` (`{ value, cap, short } | null` each) became a single `gear.findings`
  array of the same `{ key, severity, text }` shape as every other finding, reusing
  `gearFindings()` instead of a bespoke pair of fields.
- `me.dps` became `me.amount` with a sibling `me.metric` (Minor 11, fix wave A): the field was
  named `dps` for both metrics, so a healer's facts sheet read "dps" and the model wrote "your
  DPS" for someone being measured on healing.
- `fight.badPull` gained a fourth trigger not in §4.1: a raid-deaths rule (Minor 10, fix wave A).
  Rule 2 ("80% of the group parsed under 5") is now always evaluated over the raid's DPS
  regardless of the player's own role — for a healer, "the group" the rule means is the raid's
  damage dealers, not other healers' HPS ranks — and a new rule flags a bad pull when
  `raidDeathsShare` (a constant in `T`, currently 0.3) or more of the whole raid roster died,
  so a near-wipe is detectable without a duration baseline (healers never have
  `referenceDurationSec`). Neither is in the original spec text above; both are gap-fills, not
  reversions.
- `overall.badPullCount` became `overall.badPulls` (an array of `{ name, rankPercent, reason }`,
  not a count) — the reason text is what the report actually needs.
- `overall` also gained `droppedKills` (`[{ name, reason }]`, fix wave A, Important 5): a kill
  whose WCL report errors (rather than returning `report: null`) is now skipped and recorded here
  instead of aborting the whole request.
- Each kill gained `killsOnBoss` and `killIndex` (task-rep-kill, 2026-09-05): how many ranks that
  boss had, and which one (oldest-first) is being shown, so the facts table can say which pull this
  is (`Anetheron (kill 3 of 7 kills)`) now that the analysed rank need not be the most recent — see
  the rewritten step 2 above.

### 3.4 Reference selection and cache

Per `(encounterId, class, spec, itemLevelBand, region)`:

1. Band is the player's `bracketData` ±2 item levels.
2. Page the encounter's character rankings for the spec in the player's region, up to 5 pages,
   stopping once 8 in-band ranks are collected. Fewer than 3 → widen to ±4 once; still fewer
   than 3 → `reference: null` and a finding of severity `info`: "too few same-item-level
   parses to compare against".
3. Reference DPS and duration are the **median** over all in-band ranks collected (up to 8).
4. Per-cast stats, cast counts, consumables and buffs come from the tables of the **3
   highest-ranked in-band players**, fetched with the §2.3 query (their `sourceID` from the
   report's `masterData`). Values are medians of the three. Cast counts are normalised to the
   player's fight length before comparison (§4.3). Their `gear[]` from the fight-wide
   DamageDone table (already fetched for active time) is run through `summarizeGear` and
   `derivedStats` to give the reference `stats` (§4.8); no extra query.
5. Cached in memory for 24 hours. Rankings shift slowly enough that a day-old reference is fine.

Why in-band rather than the top parse: the top parse tells the player what a better-geared
player does; the band tells them what players *like them* do, which is the bar they can
actually be judged against. The prompt still receives the band's top DPS so it can mention
the ceiling.

## 4. Facts derivation (deterministic, tested)

Every rule below produces a finding with a fixed `key` so tests can assert on it. Thresholds
are constants in `vet-feedback.js`, not user-editable in v1.

### 4.1 Bad pull

`badPull` when any of: fight duration > 2× reference duration; 80% or more of the raid's DPS
parsed under 5; the raid's `speed.rankPercent` < 5 with the player's raid rank in the top
half. Reason text names which. A bad pull's own findings are dropped from `overall` and the
kill is listed under "not on you".

### 4.2 Uptime and deaths

- `active_low`: `activePercent` under 85 → major; under 92 but 8+ points under the raid's
  median DPS → minor. Text gives the number and the raid median.
- `died`: player died before 90% of the fight → major, with time and killing blow.
- `casts_low`: `castsPerMinute` under 85% of the reference → minor (only when `active_low` did
  not fire, so the two do not double-count).

### 4.3 Rotation

Cast counts are compared per minute of fight. With `r` the reference's per-minute count and
`p` the player's:

- `ability_unused`: the reference casts an ability ≥ 1.5/min (or ≥ 1 per fight for
  cooldowns like Curse of Doom, Shadowburn, potions) and the player never cast it → major
  for the reference's top-3 abilities by damage share, else minor.
- `ability_extra`: the player casts something ≥ 1/min that the reference never casts → minor.
  (Immolate on a Shadow Bolt build.)
- `ability_ratio`: for the reference's top-3 damage abilities, `p < 0.7 r` → minor.

Utility casts (Life Tap, healthstones, bandages, curses used by other locks) are listed in
the sheet but do not produce findings unless in the reference's top 3.

### 4.4 Damage per cast

For each of the reference's top-3 damage abilities present for the player:

- `crit_low`: crit percent 10+ points under the reference → major.
- `hit_low`: average non-crit hit under 85% of the reference → major.
- `resist_high`: resisted+partial share 10+ points over the reference → minor, text points at
  spell hit / Curse of the Elements.

Reference values are medians of the three reference players (§3.4).

### 4.5 Consumables and buffs

From `consumablesAtPull` (the CombatantInfo auras filtered by a small name table of TBC
flasks, battle elixirs, guardian elixirs, food buffs, weapon oils, and drums):

- `no_flask_or_elixirs`: neither a flask nor (battle + guardian) → major.
- `wrong_elixir`: battle elixir present but it is a mana/utility one (Draenic Wisdom, Major
  Mageblood is guardian; table lists which are damage-neutral) while the reference used a
  damage one → minor. Text names both.
- `no_food`: no Well Fed → minor.
- `no_potion`: `potionUse` 0 and the fight was over 60 s → minor.
- `buffs_missing`: class buffs the reference had at pull that the player lacked (from
  a table of party-scoped buffs relevant to the metric: Moonkin Aura, Blood Pact, Prayer of
  Spirit, Battle Shout, Leader of the Pack, Trueshot Aura, Ferocious Inspiration, totems
  visible as auras, Sanctity Aura …) → minor, one finding listing them. This is group
  composition, so the text says "ask to be grouped with" rather than blaming the player.
- `bloodlust_uptime`: Bloodlust uptime 0 on a fight where the reference had it → minor.

### 4.6 Gear (from the vetting profile)

Reuses the profile: `missing_enchants` (count and slots), `empty_sockets`, `hit_under_cap`
(value, effective cap, shortfall), `defense_under_cap`. Severity follows the vetting rules
(fail → major, warn → minor).

### 4.8 Stats versus peers

The player's `stats` come from the vetting profile's gear-derived numbers (`computedFromGear`,
with WCL-reported ratings preferred where present, as the profile already does). The
reference `stats` come from the three reference players' logged gear (§3.4), medians. Only the
stats that matter for the metric are compared, by role:

| Role | Compared |
|---|---|
| caster dps | spellDamage, spellCrit, spellHit, haste |
| melee / hunter dps | attackPower or rangedAttackPower, meleeCrit, meleeHit, haste |
| healer | healing, spellCrit, mp5 (reduced report only lists them) |

- `stat_low`: the primary stat (spell damage / attack power) under 90% of the reference →
  major; a secondary stat (crit, haste) 15% or more under → minor. Text gives both numbers,
  so "your spell power is 890, players at your item level have 1050" is a line the model can
  use directly, and it is what explains a `hit_low` finding.
- When `stat_low` and `hit_low` both fire for the same role, the merge (§4.10) keeps `hit_low`
  as the symptom line and attaches the stat numbers to it rather than listing two findings.
- Set bonuses are not applied on either side (`setBonusesApplied: false` in the profile), so the
  comparison is like for like.

### 4.9 Raid debuffs on the boss

From the fight's `debuffs` table, a fixed table of metric-relevant raid debuffs with their
WCL names and the roles they help:

| Debuff | Helps | Source |
|---|---|---|
| Curse of the Elements | casters (arcane, fire, frost, shadow) | warlock |
| Misery | casters | shadow priest |
| Shadow Weaving | shadow casters | shadow priest |
| Fire Vulnerability (Improved Scorch) | fire casters | fire mage |
| Winter's Chill | frost casters | frost mage |
| Sunder Armor / Expose Armor | physical | warrior / rogue |
| Faerie Fire | physical | druid |
| Blood Frenzy / Improved Expose Weakness (Expose Weakness) | physical | arms warrior / survival hunter |
| Judgement of the Crusader | holy (paladin, and Holy damage) | paladin |
| Curse of Recklessness | physical (armor) | warlock |

- `debuff_missing`: a debuff that helps the player's role was never present → one finding
  listing them, severity minor. Text says this is raid composition ("the raid had no shadow
  priest, so no Misery"), not the player's fault, and names the value ("Misery is 5% spell
  hit; Shadow Weaving is 10% shadow damage").
- `debuff_uptime_low`: present but under 70% uptime → minor, names the debuff and the uptime.
  When the player's own class provides it (a warlock and Curse of the Elements) the text
  addresses them directly ("keep Curse of the Elements up").
- Bad pulls (§4.1) skip these findings like every other.

### 4.10 Ranking findings

`overall.findings` merges per-kill findings by `key` (the same finding on three bosses is one
line, "on 3 of 4 bosses"), drops bad pulls, and orders: major before minor, then by how many
kills it appeared on, then by the damage share of the ability it concerns. Capped at 6.

## 5. The report

### 5.1 Prompt

System prompt, fixed:

- You are writing to a WoW TBC Anniversary raider on behalf of their raid leader. Second
  person, friendly, direct, no fluff.
- Use **only** the facts in the sheet. Never invent a number, an ability, a buff or an item. If
  the sheet does not support a claim, do not make it.
- The Anniversary rules from `AI_SYSTEM_PROMPT` in `server.js` (Bloodlust raid-wide,
  everything else party-scoped, one air totem …), extracted into a shared constant.
- Structure, plain text, no markdown headings:
  1. One header line: name, spec, tier, median parse.
  2. "What's holding your damage back" — the `overall.findings`, biggest first, at most 5,
     each as: what it is, the measured number next to the reference number, one concrete fix.
     Findings about group buffs and raid debuffs (§4.5 `buffs_missing`, §4.9) are phrased as
     things to ask the raid leader for, never as the player's failing.
  3. "What's fine" — one or two lines from things that were good (active time, no deaths,
     consumables present), so the note is not only negative.
  4. "Not on you" — each bad pull with its reason, one line each. Omit the section if none.
- Under 350 words.

User message: the facts sheet as JSON.

Model: `process.env.OPENAI_MODEL || 'gpt-5-mini'`, same as `/api/ai-review`, 60-second
timeout.

### 5.2 Guard

After the model answers, the server checks that every number token in the reply (integers
and percentages) appears in the facts sheet's serialised form, allowing a ±1 rounding
tolerance. A reply that fails the check is returned with `reportError:
"model introduced figures not in the facts"` and `report: null`; the facts sheet still shows.
This is cheap and catches the failure mode that matters most for something the leader will
forward.

### 5.3 Fallback text

When `report` is null the page renders the facts sheet's `overall.findings` texts as a plain
bulleted list under the same headings, so there is always something to copy. The finding
`text` fields are written to read acceptably on their own.

## 6. Client

- In the detail panel's Parses box, below the boss table: a **"Feedback report"** button.
  Disabled with a tooltip when the profile has no parses.
- Click → button shows "Analysing…"; the page fetches `/api/vet/feedback`. A 429 uses the
  existing pause path. Errors render as a status line in the box, never an alert.
- Result renders under the button: the report in a `<pre class="feedback-report">`, a
  **Copy** button (clipboard; falls back to selecting the text), and a collapsed
  **"Facts"** section that renders, per kill, a small table: boss, parse, duration vs
  reference, active %, raid rank, DPS vs band, crit % vs band, consumables, link to WCL.
  Bad pulls are greyed with their reason.
- The response is stored in `state.feedback[key]` (localStorage) with `generatedAt`, so
  re-opening the row shows the last report without a fetch. "Refresh all" clears it.
  Removing a player removes it.

## 7. Testing

- `vet-feedback.test.js` (node, `npm test`): facts derivation from the captured fixture —
  bad pull fires on Kaz'rogal (1131 s vs 93 s, raid-wide zeros) and not on Anetheron; active
  time 92 on Anetheron; `crit_low` and `hit_low` fire on Shadow Bolt with the fixture's
  numbers; `ability_extra` fires for Immolate; `wrong_elixir` fires for Draenic Wisdom;
  `buffs_missing` lists Moonkin Aura and Blood Pact; `debuff_missing` lists Misery and Shadow
  Weaving for the Anetheron pull while Curse of the Elements at 91% produces nothing; `stat_low`
  compares the fixture's gear-derived spell damage against the three reference players' and
  attaches its numbers to `hit_low` in the merge; reference band selection over a stubbed
  rankings page set (stops at 8, widens once, gives null under 3); overall merge, ordering
  and cap; the number guard accepts the fixture-consistent reply and rejects a reply with a
  foreign figure; the healer path produces `limited: true` and no per-cast findings.
- Route: WCL and OpenAI stubbed; asserts the response shape, the 15-minute cache, the
  model-failure path (`report: null`, facts present), and 429 propagation.
- Browser: headless-Chrome CDP smoke — button appears in the expanded row, click renders the
  stubbed report, Copy puts the text on the clipboard, reload shows the stored report.
- Manual: run on Rotminster and two other failing players; the leader reads the reports and
  confirms they match what they know. Adjust §4 thresholds if a finding is noise.

## 8. Out of scope

- Editable thresholds for the findings (constants in v1).
- Healer per-cast analysis (overhealing, spell selection). Healers get the reduced report.
- Trash-inclusive Hyjal pulls: handled only through the bad-pull rule, not by trimming the
  fight to the boss phase.
- Storing reports server-side or sharing by link; the report is copied as text.
- Any change to the vetting verdict itself. The bad-pull knowledge could later exclude such
  kills from the median, but that is a separate decision.

## 9. Verified probe queries

Ran successfully 2026-09-04 against the classic host; the probe scripts were throwaway.

```graphql
query($name:String!,$server:String!,$region:String!){characterData{character(name:$name,serverSlug:$server,serverRegion:$region){
  e50619:encounterRankings(encounterID:50619,metric:dps)
  e50620:encounterRankings(encounterID:50620,metric:dps)
}}}

query($c:String!,$f:[Int]!){reportData{report(code:$c){
  masterData{actors(type:"Player"){id name subType}}
  fights(fightIDs:$f){id name startTime endTime kill}
  rankings(fightIDs:$f)
  dmgAll:table(dataType:DamageDone,fightIDs:$f)
  deaths:table(dataType:Deaths,fightIDs:$f)
  summary:table(dataType:Summary,fightIDs:$f)
  debuffs:table(dataType:Debuffs,fightIDs:$f,hostilityType:Enemies)
}}}

query($c:String!,$f:[Int]!,$s:Int!){reportData{report(code:$c){
  dmg:table(dataType:DamageDone,fightIDs:$f,sourceID:$s)
  casts:table(dataType:Casts,fightIDs:$f,sourceID:$s)
  buffs:table(dataType:Buffs,fightIDs:$f,sourceID:$s)
  ci:events(dataType:CombatantInfo,fightIDs:$f,sourceID:$s,limit:5){data}
}}}

query($e:Int!,$p:Int!){worldData{encounter(id:$e){
  characterRankings(metric:dps,className:"Warlock",specName:"Destruction",serverRegion:"eu",page:$p)
}}}

{rateLimitData{limitPerHour pointsSpentThisHour pointsResetIn}}
```
