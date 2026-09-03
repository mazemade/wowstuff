# Player vetting page — design

**Date:** 2026-09-03
**Status:** Approved design, awaiting implementation plan

## 1. Problem

Raid invites regularly go to people who turn out to be under-geared, under hit cap, missing
enchants, or simply weak. Finding that out mid-raid costs a boss or a night. The raid leader
needs to check a player in seconds, at two moments:

1. **Quick check.** Someone whispers in-game asking for an invite. The leader types the name
   into the tool and gets a verdict before answering.
2. **Roster review.** Before the raid, run everyone who signed up or is on the current roster
   through the same check and see who needs a word or a replacement.

Both happen in the web tool. The in-game addon cannot help pre-invite: the 2.5.6 client only
allows inspecting a unit within 28 yards (`CanInspect` / `CheckInteractDistance(unit, 1)`),
so nobody who is not standing next to the leader can be inspected.

## 2. Data source: Warcraft Logs

Everything comes from the WCL v2 classic API, which the server already authenticates against
(`WCL_CLIENT_ID` / `WCL_CLIENT_SECRET`). Verified live on 2026-09-03 against a Spineshatter-EU
character:

- **Zone 1060** is the Anniversary Black Temple / Hyjal tier (14 encounters). Zone 1056 is
  SSC/TK, which is what the multiplier prefill still uses; `worldData.zones` does not list
  either, so both must be addressed by id. The vetting page defaults to 1060.
- `characterData.character(name, serverSlug, serverRegion).zoneRankings(zoneID, metric)`
  returns `bestPerformanceAverage`, `medianPerformanceAverage`, and per-encounter
  `rankings[]` with `rankPercent`, `medianPercent`, `totalKills`, `fastestKill`, `spec`,
  `bestSpec`, `bestAmount`, and `allStars`.
- `character.recentReports(limit)` returns report codes with `fights(killType:Encounters)`.
- `reportData.report(code).events(dataType: CombatantInfo, fightIDs:[…])` returns one row per
  player with:
  - `gear[19]` in inventory-slot order (head, neck, shoulder, shirt, chest, waist, legs, feet,
    wrist, hands, finger1, finger2, trinket1, trinket2, back, main hand, off hand, ranged,
    tabard), each `{ id, quality, itemLevel, permanentEnchant?, gems?[{id}], setID? }`.
    Shirt and tabard report `itemLevel: 1`.
  - Live ratings measured by the client: `hitMelee`, `hitRanged`, `hitSpell`, `expertise`,
    `critMelee`, `critRanged`, `critSpell`, `hasteMelee`, `hasteRanged`, `hasteSpell`,
    `dodge`, `parry`, `block`, `armor`, and `strength`, `agility`, `stamina`, `intellect`,
    `spirit`.
  - `talents[3]` = points per tree (ids 1–3 in tree order with icons), enough for spec
    detection. Not the individual talents.
  - `auras[]` = buffs at pull. Not used by this feature.
  - `masterData.actors(type:"Player")` maps `sourceID` to name and server.
- Not present in combatant info: spell damage, healing, attack power, defense, mana per five.
  These are computed from gear (§4).

Limits accepted by design:

- Only players who have logged a raid exist on WCL. Absence is reported as "unverified", not
  as a failure.
- Gear is as of the player's last logged fight; the report timestamp is surfaced as
  "last seen" and a staleness rule warns past four weeks.
- WCL rate limits (HTTP 429) pause the fetch queue; the existing `RATE_LIMIT` error path is
  reused.

## 3. Architecture

Approach chosen: the **server builds a complete profile** per player; the browser applies
rules and renders. The wowsims item database stays server-side.

```
vetting.html / vetting.js / vetting.css   page: inputs, thresholds, table, detail panel
vet-engine.js (+ vet-engine.test.js)      pure UMD module: spec/role detection, stat sums,
                                          cap arithmetic, rule evaluation, sorting
server.js  GET /api/vet/player            three WCL queries + gear join, in-memory cache
calibration/vendor/tbc-new/assets/database/db.json   items / gems / enchants (read-only)
```

### 3.1 Server route

`GET /api/vet/player?name&server&region&zone`

Validation mirrors `/api/wcl/player`. Steps:

1. `recentReports(limit: 3)` for the character. Take the newest report that contains a fight
   the character participated in; fetch that fight's `CombatantInfo` events and the
   `masterData.actors`, pick the row whose `sourceID` resolves to the character's name.
   If no report in the three has a combatant row for them, `gear`, `reported` and
   `computed` are null and `missing` says so.
2. Detect spec and role from `talents` (§5). Role decides the rankings metric: `hps` for
   healers, `dps` otherwise.
3. `zoneRankings(zoneID, metric)` for the requested zone. If the result has no encounter
   with a kill (a player who has not logged the current tier yet), query the **previous tier**
   (zone 1056, SSC/TK) and use that instead. The profile records which zone the parses came
   from, and the table labels the parse cell with the tier ("SSC/TK") so a previous-tier
   number is never mistaken for a current one. If neither tier has parses, `parses` is null.
4. Join gear with the wowsims tables (§4).
5. Return the profile (§3.2). Cache the response in memory per `region/server/name/zone`
   for 15 minutes so a roster refresh does not re-hit WCL.

`db.json` is loaded lazily on first request and indexed by item id, gem id and enchant
`effectId`. Load failure is a 500 with a clear message; the file is a checked-in vendor asset.

### 3.2 Profile object

```
{
  name, server, region, zone,
  identity: { class, spec, role, talentSplit: [a, b, c], detectedFrom: "talents"|"wcl" },
  lastSeen: { reportCode, fightName, timestamp } | null,
  gear: [ { slot, id, name, itemLevel, quality, enchant: {id, name}|null,
            gems: [{id, name}], emptySockets, enchantable } … 17 entries ] | null,
  reported: { hitMelee, hitRanged, hitSpell, expertise, critMelee, critRanged, critSpell,
              hasteMelee, hasteRanged, hasteSpell, dodge, parry, block, armor,
              strength, agility, stamina, intellect, spirit } | null,
  computed: { avgItemLevel, spellDamage, healing, attackPower, rangedAttackPower,
              defenseRating, defenseSkill, mp5, spellHit, meleeHit, expertise, spellCrit,
              meleeCrit, … , setBonusesApplied: bool, socketBonusesApplied: bool } | null,
  parses: { zone, zoneName, fallback: bool, metric, medianPercent, bestPercent,
            bosses: [ { encounterId, name, medianPercent, bestPercent, kills, fastestKillMs } ] }
          | null,
  missing: [ "no combatant data in last 3 reports", … ]
}
```

### 3.3 Client

- **Inputs.** Name box + "Add" (Enter submits). "Load roster" reads the assignments page's
  saved state (`raidAssignmentsState` plus the `raidAssignmentsLinkMap` identity links, run through the engine's `deriveRoster`) and its `wcl.server` /
  `wcl.region`. Realm and region are shown read-only with a link to the assignments page.
  "Refresh all" bypasses nothing server-side; the cache is the server's concern.
- **Queue.** One request per player, concurrency 3. A 429 pauses the queue, shows a
  countdown, and resumes.
- **Threshold strip.** The rules of §6 as numeric inputs, persisted in local storage under
  `raidVettingState` together with the player list and last profiles. "Reset defaults".
- **Summary line.** Counts of pass / warn / fail / unverified.
- **Table.** Sorted fail → warn → unverified → pass, then name. Columns: verdict, name, spec,
  item level, hit, expertise, defense, parse median, enchants missing, sockets empty, last
  seen. Every cell shows value and threshold and is coloured by its rule; a shortfall is
  spelled out, e.g. `118 / 142 (−24)`. Unknown is `?` in grey with the reason as tooltip.
  An `x` removes the player.
- **Detail panel** on row click: the 17 slots with enchant and gems, the full stat sheet
  (reported and computed side by side), per-boss parses, and the `missing` list.

Every failure is a row state. No alerts.

## 4. Gear stat computation

Uses `db.json`: `items[]` (`scalingOptions["0"].stats`, `gemSockets`, `socketBonus`,
`setId`), `gems[]` (`stats`, `color`), `enchants[]` (`effectId`, `stats`). Stat arrays are
indexed by the `Stat` enum in `calibration/vendor/tbc-new/proto/common.proto`
(0 strength … 4 healing, 5 spell damage, 12 spell hit, 17 attack power, 20 melee hit,
24 expertise, 25 defense rating, 31 armor, and so on).

- Sum item base stats, enchant stats and gem stats over the 17 slots.
- Socket bonus: applied when every socket on the item holds a gem whose colour matches
  (prismatic and meta rules per wowsims). `socketBonusesApplied` records that this was done.
- Derived: `avgItemLevel` over the 17 slots (empty slot counts as 0 and is flagged);
  `defenseSkill = 350 + floor(defenseRating / 2.37)`; `expertiseSkill = floor(rating / 3.94)`;
  percentages from ratings use the level-70 constants (15.77 rating per 1% melee/ranged hit,
  12.62 per 1% spell hit).
- Set bonuses: `db.json` carries `setId` per item but no set-bonus table, so they are not
  applied and `setBonusesApplied` is always `false`. Socket bonuses are applied (colour rules
  above), `socketBonusesApplied: true`.
- Validated on the captured fixture (`fixtures/wcl-vet-nottomwro.json`): the computed melee
  hit (171) and haste (65) equal what WCL reported, which confirms the item, gem and enchant
  join. Computed crit was 20 rating under the reported value and base attributes and armor
  differ by the character's base stats, which is why reported values win where present.
- Enchantable slots for the missing-enchant rule: head, shoulder, back, chest, wrist, hands,
  legs, feet, main hand, off hand (weapon or shield), ranged (hunters only). Rings only for
  enchanters — detected from an existing ring enchant, otherwise rings are not counted.

**Reported versus computed.** Where WCL reported a rating, the table shows the reported value
and the computed value only fills what WCL lacks. If the two differ by more than 5% of the
cap, the row gets a note, since that usually means the logged gear is not what was equipped
at the pull.

## 5. Spec and role detection

- Spec from the three-tree point split, using the same tree-dominance convention as
  `Scan.lua` (`ActiveGroup` / `TalentString`); the engine's spec names are reused.
  Hybrid splits that the addon would mark `?` fall back to WCL's `bestSpec` from the
  rankings, with `detectedFrom: "wcl"`.
- Role from the engine's existing spec → role mapping in `assignments-engine.js`. No new
  tables.

## 6. Rules and verdict

Defaults, all editable in the threshold strip:

| Rule | Default | Applies to |
|---|---|---|
| Average item level | ≥ 125 | everyone |
| Melee / ranged hit rating | ≥ 142 (9%) | melee dps, hunters |
| Spell hit rating | ≥ 202 (16%) | caster dps |
| Expertise (skill points) | ≥ 26 (6.5%) — warn only | melee dps, plate tanks |
| Defense skill | ≥ 490 | tanks except druids |
| Median parse percentile | ≥ 40 | everyone with parses, current tier or the previous one as fallback |
| Missing enchants | warn at 1, fail at 3 | enchantable slots |
| Empty sockets | warn at 1, fail at 3 | everyone |
| Data age | warn past 28 days | everyone |

**Talent allowances.** The engine holds a per-spec table of hit rating granted by the talents
every standard build takes, and the effective cap is the role threshold minus that allowance.
Initial table (percent → rating at level 70):

| Spec | Talent | Allowance |
|---|---|---|
| Warrior Arms/Fury | Precision 3% | 47 |
| Rogue (all) | Precision 5% | 79 |
| Shaman Enhancement | Dual Wield Specialization 6% | 95 |
| Hunter (all) | Surefooted 3% | 47 |
| Mage Fire/Frost | Elemental Precision 3% | 38 |
| Mage Arcane | Arcane Focus 10% (arcane spells only) | 126 |
| Warlock Affliction | Suppression 10% (affliction spells only) | 126 |
| Priest Shadow | Shadow Focus 10% | 126 |
| Druid Balance | Balance of Power 4% | 50 |
| Shaman Elemental | Elemental Precision 6% | 76 |

Raid-provided hit (Misery, Improved Faerie Fire, Draenei aura) is not assumed. The cell
tooltip shows threshold, allowance, effective cap, and the player's value.

**Units.** Expertise is compared in skill points: `floor(rating / 3.94)`. WCL's `expertise`
field and the item-table stat 24 are both ratings, so both are converted before the compare.
Hit and defense compare in rating and skill respectively, as listed.

**Severity.** Item level, hit, defense and median parse fail when under threshold. Expertise
only warns: the dodge cap is a refinement, not a gate, and few TBC melee reach it. Missing
enchants and empty sockets warn at the first count and fail at the second. Staleness warns.

**Verdict.** `fail` if any rule fails; else `warn` if any rule warns; else `pass`.
`unverified` when there is no gear data or no parse data at all; a player with parses but no
gear is `unverified` for gear rules and the parse rule still evaluates. Unverified is not a
failure: the row says exactly what is missing.

**Calibration pass.** The defaults above are provisional. The implementation plan ends with a
step that runs the real roster through the page, compares the verdicts to the raid leader's
own judgement, adjusts the defaults, and records the outcome in this spec.

## 7. Testing

- `vet-engine.test.js` (node, part of `npm test`): stat summation from fixture gear against
  hand-computed totals; socket-bonus activation; spec and role detection from talent splits
  including hybrid fallback; cap arithmetic with allowances; verdict for every state; sort
  order; threshold parsing and defaults.
- Server route: the WCL calls are stubbed with a fixture captured from the live probe
  (a real combatant row, actors list, and zoneRankings blob), so the join and the
  "no combatant data" path are covered without network. Fixture lives under `fixtures/`.
- Browser: driven through the existing headless-Chrome CDP harness for a smoke pass (add a
  name, threshold edit re-scores without refetch, rate-limit pause renders).
- Calibration pass as in §6.

## 8. Out of scope

- In-game gear scan after invite. Existing addons (RaidInspector, RaidCheck, GearGuardian)
  already cover enchants, gems and GearScore in-raid; none checks hit cap. Can be a later
  phase on top of the `/specscan` inspect queue.
- Consumables, buffs at pull, and raid-provided hit.
- Feeding the vetting profile into the group optimizer multiplier. The multiplier prefill
  keeps its own route; sharing the WCL cache between the two is a possible follow-up.
- Automatic Raid-Helper signup import on this page; the roster comes from the assignments
  page's saved state, which already merges and links signups.

## 9. Verified probe queries

Kept for the implementer; these ran successfully on 2026-09-03.

```graphql
query { characterData { character(name:"…", serverSlug:"spineshatter", serverRegion:"eu") {
  id classID
  zoneRankings(zoneID:1060, metric:dps)
  recentReports(limit:3) { data { code startTime fights(killType:Encounters) { id encounterID name kill } } }
} } }

query($code:String!, $f:[Int]!) { reportData { report(code:$code) {
  masterData { actors(type:"Player") { id name server subType } }
  events(dataType:CombatantInfo, fightIDs:$f, limit:100) { data }
} } }
```
