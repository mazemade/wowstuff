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
}}}
```

- `rankings` (JSON scalar): `data[0]` has `duration`, `deaths`, `bracketData`,
  `speed { rankPercent }`, `execution { rankPercent }`, and `roles.dps.characters[]` with
  `name`, `amount`, `rankPercent` for every DPS in the raid. `roles.healers` likewise.
- `dmgAll.data.entries[]` (fight-wide): per player `name`, `type`, `total`, `activeTime`,
  `activeTimeReduced`, `itemLevel`, `talents`, `gear`. `data.totalTime` is the fight length.
  Active time is read from here; the per-player (sourceID-scoped) tables do not carry it.
- `deaths.data.entries[]`: `name`, `timestamp`, `killingBlow { name }`.

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
   and take each encounter's most recent rank as the kill to analyse.
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
    me: { dps, activePercent, died: { atSec, by } | null, potionUse, healthstoneUse,
          consumablesAtPull: [name…], buffsAtPull: [name…],
          castsPerMinute, casts: { ability: count },
          abilities: [ { name, share, avgHit, avgCrit, critPercent, resistPercent } ] },
    reference: { itemLevelBand: [lo, hi], sampleSize, dps, durationSec, activePercent,
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
   player's fight length before comparison (§4.3).
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

### 4.7 Ranking findings

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
  `buffs_missing` lists Moonkin Aura and Blood Pact; reference band selection over a stubbed
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
