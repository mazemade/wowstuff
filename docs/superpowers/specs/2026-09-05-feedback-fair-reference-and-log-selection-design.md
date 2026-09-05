# Feedback report v2: fair reference, raid-night selection, two pulls per boss, burst timing

Date: 2026-09-05. Extends `2026-09-04-parse-feedback-report-design.md` (the v1 spec); everything
not mentioned here stays as v1 specifies. Section numbers below refer to this document unless
prefixed "v1".

## 1. Problem

Verified live on 2026-09-05 against Dotwin (Destruction, Spineshatter EU) and Rotminster:

1. **The reference is the top of the leaderboard, not "players like you".** v1 §3.4 reads pages
   1–5 of `characterRankings` (the 500 highest-DPS parses of roughly 2000), keeps those within
   ±2 item level, and fetches the tables of the **3 highest-DPS** of them. The best parse at a
   fixed item level is by construction the lucky-crit, short-kill, fully-buffed one. Measured
   Shadow Bolt crit for Destruction warlocks at item level 117–121 on Morogrim: the three we
   compare against 46.6 / 54.7 / 63.0; around leaderboard rank 600: 48–52; around rank 1200
   (below the median): 40–50. Talents (0/21/40), intellect and crit rating were the same across
   all of them. Every "comparable players" figure — crit, average hit, spell power, casts per
   minute, and the "typical" duration used by the bad-pull rule — carries this bias. Rerunning
   Rotminster's pipeline with the reference drawn from the middle of the leaderboard removed the
   crit finding entirely (26.2 vs 36.1 instead of 26.2 vs 58.8), turned Rage Winterchill from a
   "bad pull" (187 s vs a "typical" 91 s) into an ordinary slow kill (vs 121 s), and left the
   believable gaps: DPS 1300 against a median 2190, casts per minute, Curse of Doom and
   Shadowburn never cast, no flask, missing group buffs.
2. **One pull per boss cannot separate a habit from a one-off**, and the one-kill-per-boss
   assumption is expiring (Dotwin has three kills on Morogrim).
3. **A raid leader wants to say "last Thursday you did this"**: analyse one raid night, not the
   representative kill across the tier.
4. **On-use items and potions are compared by count only**, never by timing; using them inside
   the Bloodlust window is a large, cheap DPS gain that the report cannot see.
5. **The model drops findings it dislikes** (two of six in the last live run) and the ceiling
   ("what the best same-gear players reach") never appears although v1 §3.4 reserved it.
6. v1 §2.5's cost table is stale: measured on 2026-09-05 a ranking page costs 2 points, the
   fight-context query 9, the player-tables query 5.

## 2. Data (all verified live 2026-09-05)

- `characterRankings` has no total count: the response carries only `page`, `hasMorePages`,
  `count` (page size, 100) and `rankings`. A page past the end returns `rankings: undefined`.
  Leaderboard length is therefore found by walking `hasMorePages` (binary search, ≤ 64 pages,
  6 queries, 2 points each).
- `characterRankings` rows carry `name, class, spec, amount, duration, startTime, report{code,
  fightID}, guild, server, bracketData, faction, size`. No `rankPercent`.
- `characterData.character.encounterRankings(encounterID, metric).ranks[]` carries, per kill,
  `startTime, rankPercent, amount, duration, bracketData, report{code, fightID}`. Grouping these
  by `report.code` across every killed encounter of the zone is the raid-night list; it costs
  nothing beyond querying every killed encounter instead of the 8 picked ones (measured: 10
  aliased encounters 8 points, 1 encounter 2 points).
- The v1 `PLAYER_QUERY` Buffs table (`table(dataType:Buffs, sourceID)`) already returns, per
  aura, `bands: [{startTime, endTime}]` — one band per application — alongside `totalUptime`
  and `totalUses`. Bloodlust on Rotminster's Anetheron kill: one band of 40 s. No extra query.
  **The captured fixture `fixtures/wcl-feedback-rotminster.json` was slimmed at capture time and
  its auras carry no `bands`**; tests add bands to a deep-cloned fixture (§8).
- On-use trinkets appear in the Casts table under their buff name (Rotminster's reference:
  `Blessing of the Silver Crescent: 1` next to `Curse of Doom: 1`), and as an aura of the same
  name with bands in the Buffs table. Potions appear as a cast named after the potion and an
  aura named after the effect (`Destruction Potion` → aura `Destruction`).
- Measured point costs (rateLimitData deltas): ranking page 2.01, `encounterRankings` ×1 2.01
  and ×10 8.01, `FIGHT_QUERY` 9, `PLAYER_QUERY` 5, Buffs table alone 2, `recentReports(10)` 11.

## 3. Reference selection (replaces v1 §3.4 steps 2–4)

Per `(encounterId, class, spec, region)` the **leaderboard length** `L` (last non-empty page):
binary search over `hasMorePages` in pages 1..64, cached in `refCache` under key
`<encounterId>/<class>/<spec>/<region>/length` for `REF.lengthCacheMs` = 7 days. Independent of
item level, so every player of the spec shares it.

Per `(encounterId, class, spec, region, band)`:

1. Band is `bracketData` ±`REF.band` (2), widened once to ±`REF.wideBand` (4) exactly as v1.
2. **Benchmark ranks.** Read pages outward from the middle: `mid = max(1, round(L / 2))`, then
   `mid, mid+1, mid-1, mid+2, mid-2, …` (skipping pages < 1 or > L), at most `REF.maxPages` (5)
   pages, stopping once `REF.target` (8) in-band ranks are collected. Order the collected in-band
   ranks by distance from the middle rank (`|globalRank − 50·L|`, where `globalRank = (page−1)·100
   + indexOnPage + 1`), nearest first. Fewer than `REF.min` (3) → widen once → still fewer →
   `summary: null` with the v1 note.
3. **Reference players** are the first `REF.players` (3) of that ordering — the in-band parses
   nearest the middle of the leaderboard, not the highest-DPS ones. Their tables are fetched as
   in v1; `referenceSummary` is unchanged except for the new `burst` block (§6) and the
   `topDps` source below.
4. **Ceiling.** Read pages 1.. until at least one in-band rank is seen, at most `REF.topPages`
   (3) pages; `topDps` is the highest in-band `amount` seen, or null if none in 3 pages. `dps`
   and `durationSec` remain medians over the benchmark ranks of step 2.
5. Cache as v1 (24 h, keyed by band, `findRefEntry` scan unchanged).

`reference.itemLevelBand`, `sampleSize`, `playersCompared` keep their v1 meaning. New field
`reference.benchmark: 'median'` so the prompt and the facts table can say what "comparable"
means. The prompt line defining "comparable players" changes to: "players of the same spec on
the same boss, at your item level, who parse around the middle of the leaderboard".

Cost per boss and spec, cold: length walk 12 (weekly) + benchmark pages ≤ 10 + top pages ≤ 6 +
3 × 14 for players = about 70; v1 measured today is about 52.

## 4. Pulls per boss (replaces v1 §3.1 step 2's "one rank")

Default mode analyses up to `KILLS_PER_BOSS` (2) ranks per boss: the representative rank
(`pickRank`, unchanged) and the most recent rank by `startTime`, deduplicated. One rank when the
boss has one, or when both rules pick the same one. `KILL_LIMIT` (8) still counts bosses. Each
analysed rank becomes one entry in `facts.kills` with its own `killIndex`, `rankPercent`, date,
reference (shared per boss through the cache) and findings.

Consequences, all deterministic:

- `mergeFindings` counts across **pulls** whenever the sheet holds more than one pull of any boss:
  the suffix reads "seen on N of M pulls" and `measuredOn` becomes "`<boss>` (`<date>`)" for a
  boss with several pulls. With one pull per boss the v1 wording ("bosses", boss name only) is
  kept verbatim.
- `positives` says "pulls" instead of "bosses" whenever any boss has more than one pull; with one
  pull per boss the v1 wording is kept verbatim (existing assertions stay green).
- `overall.badPulls` lists pulls, each with its date.
- The facts table (v1 §6) renders one row per pull; the "(kill i of n kills)" cell already exists.

Cost: doubles only for bosses with ≥ 2 kills. Today's roster is unaffected (one kill per boss).

## 5. Raid-night mode

### 5.1 Nights list (always present)

`fetchFeedback` queries `encounterRankings` for **every** encounter in `profile.parses.bosses`
with `kills > 0` (not just the 8 picked). From all ranks with a `report.code`:

```
nights: [{ code, date (ISO day of the earliest startTime), bosses: [{ encounterId, name,
           rankPercent }] sorted by rankPercent asc, medianPercent (median of rankPercents,
           round1) }]
```

sorted newest first, capped at `NIGHT_LIMIT` (10). Placed on `facts.nights`. Cost: 2–5 points
more than v1 on a 10–14-encounter zone.

### 5.2 Selecting a night

`GET /api/vet/feedback?…&report=<code>`; `code` must match `/^[A-Za-z0-9]{16}$/`, else 400
`"Invalid report code"`. Passed to `fetchFeedback` as `o.report`. With it:

- Targets are the encounters whose ranks include a rank with that `report.code`; each such rank
  is the (only) pull analysed for that boss (§4 does not apply). No matching rank → 404
  `"No kills in that report"` (route maps `fetchFeedback` returning `{ noKills: true }`).
- Bosses sorted by that night's `rankPercent` ascending, capped at `KILL_LIMIT`.
- `facts.night = { code, date }`; default mode has `facts.night = null`.
- `facts.tier.medianPercent` stays the tier median (the verdict), and the sheet gains
  `facts.night.medianPercent` (that night's median). The prompt's header rule becomes: "name,
  spec, tier, then either 'median parse P' or, when night is set, 'raid night of <date>, median
  parse that night P'".
- Server cache key and in-flight key gain `/night/<code>` (or `/all`). Thresholds behaviour,
  sweep and `X-Vet-Cache` semantics unchanged.

## 6. Burst timing against Bloodlust (new §4.11 for v1's numbering)

For the player and each reference player, from the Buffs table:

- `bloodlustBands`: bands of the aura named `Bloodlust` (or `Heroism`).
- A **burst** is an aura that (a) has at least one band, (b) whose name also appears in the
  player's Casts table — true for on-use items and for potions alike, because WCL names a potion
  cast after its effect (the fixture's Casts table holds `Destruction: 1` for a Destruction
  Potion); `POTION_LABEL` maps those effect names back to the potion for the report text — and
  (c) is not Bloodlust. Procs never satisfy (b).
- Per burst: `{ name, uses: bands.length, insideBloodlust: bands whose [start, end] overlaps any
  Bloodlust band }`.

`me.burst: [...]`; `reference.burst: [{ name, uses (median), insideBloodlust (median) }]` for
bursts a majority of reference players have.

Findings (`consumableFindings`):

- `burst_outside_bloodlust`, minor, player: the fight had Bloodlust (`me.bloodlustPercent > 0`),
  the player used the burst ≥ 1 time, 0 of those inside Bloodlust, and the reference's median
  `insideBloodlust` ≥ 1. Text, with `<label>` = `POTION_LABEL[name] || name`: "Used `<label>`
  once on `<boss>`, never inside Bloodlust; comparable players line it up with Bloodlust" for one
  use, or "Used `<label>` `<uses>` times on `<boss>`, never inside Bloodlust; comparable players
  line it up with Bloodlust" for more. One finding per burst, `ability: name`.
- `ability_unused` (v1 §4.3) keeps flagging on-use items the reference casts and the player never
  does — they are a large DPS gain and stay in. Only the wording changes: when the unused name is
  a burst for the reference (`reference.burst` has it), the text reads "Never used `<label>` (on-use
  item) on `<boss>`; comparable players use it `<r>` times a minute", with `<label>` again
  `POTION_LABEL[name] || name` — except a potion (a name present in `POTION_LABEL`) drops the
  "(on-use item)" suffix, since `<label>` already says "Potion": "Never used `<label>` on
  `<boss>`; comparable players use it `<r>` times a minute". Either way the model is not left to
  call a trinket or a potion a spell.

## 7. Ceiling and completeness

- `overall.ceiling: [{ name, me, dps, topDps, date }]` for the two live pulls with the lowest
  `rankPercent` that have a reference with `topDps` (fewer if fewer). `me` is `me.amount`,
  `dps` the benchmark median, `topDps` the band's best.
- Prompt structure gains, between "What's fine" and "Not on you": `5. If overall.ceiling is not
  empty, a line "Where you stand", then one line per entry: your DPS, what players at your item
  level around the middle do, and what the best at your item level reach on that boss.`
- Prompt rule 2 changes "at most 5" to "every entry of overall.findings, in order (it holds at
  most 6); do not drop any". `checkNumbers` is unchanged. `fallbackReport` renders the same
  section from `overall.ceiling`.
- Prompt "Comparable players" definition per §3. `measuredOn` rule unchanged.

## 8. Client (extends v1 §6)

- `state.feedback[key]` keeps its v1 shape for the default report and gains
  `night: { code, report, reportError, generatedAt, facts } | undefined` (the last night
  fetched) and `selected: 'all' | <code>`. Old stored entries without these fields render as
  before.
- `feedbackBox`: when a stored default report has `facts.nights`, a `<select class="feedback-night">`
  appears left of the button: option "Across kills" (`all`) plus one per night, labelled
  "`<date>` · `<n>` bosses · median `<P>`". Changing it sets `selected`, saves, re-renders; the
  button fetches with `&report=<code>` unless `all`. The report, Copy text, generatedAt and
  facts table shown are those of `selected`; a night not yet fetched shows the button as
  "Feedback report" with nothing under it.
- Facts table: `Boss` cell adds the pull's date after the "(kill i of n)" note when the sheet has
  more than one pull for any boss; a "Where you stand" line is rendered above the table from
  `overall.ceiling`.
- "Refresh all", remove and removeAll clear the whole entry as today.

## 9. Cost (corrects v1 §2.5)

| Piece | Points |
|---|---|
| Kill analysed (fight context 9 + player tables 5) | 14 |
| Nights list (every killed encounter of the zone, one query) | 8–11 |
| Reference per boss and spec, cold (length 12 weekly, ≤ 8 pages, 3 players) | ≈ 70 |
| One player, 4 bosses, one pull each, references cold | ≈ 350 |
| Same, references warm | ≈ 70 |
| Same, two pulls on every boss, warm | ≈ 125 |
| Hourly budget | 3600 |

The 429 path (pause on the page, abort on the server) is unchanged.

## 10. Testing

- **Reference** (`vet-feedback.test.js`, synthetic leaderboard stub): 20 pages of 100 ranks with a
  known item-level distribution and DPS descending by rank. Asserts: length found as 20 in ≤ 6
  page queries; benchmark pages requested are 10, 11, 9, …; reference players are the 3 in-band
  ranks nearest rank 1000, not the top 3; `dps` is the median of the collected in-band ranks;
  `topDps` is the band's best from pages 1–3 and null when the band never appears there;
  widening and the "too few" note still work; the length is cached and shared across bands; the
  band cache scan (`findRefEntry`) is untouched.
- **Pulls per boss**: on a fixture clone with three ranks on Anetheron, the sheet holds the
  representative and the most recent pull (two entries, distinct `killIndex`), one entry when
  they coincide, "seen on N of M pulls" counts, `measuredOn` carries the date, positives say
  "pulls". With the untouched fixture (one rank per boss) every existing assertion stays green
  verbatim.
- **Nights**: from a fixture clone with ranks across two report codes, `facts.nights` has two
  entries newest first with the right bosses and medians; `report=<code>` analyses only that
  code's ranks, sets `facts.night`, and an unknown code yields `{ noKills: true }`.
- **Burst timing**: bands added to a fixture clone. A Destruction Potion band inside the
  Bloodlust band → no finding; the same band moved outside, with the reference's median inside
  ≥ 1 → `burst_outside_bloodlust` with the exact text; no Bloodlust on the fight → no finding; a
  proc aura (no matching cast) is never a burst; `ability_unused` for `Blessing of the Silver
  Crescent` reads "Never used … (on-use item)".
- **Ceiling and prompt**: `overall.ceiling` picks the two lowest live pulls with `topDps`; the
  prompt text contains "Where you stand", "do not drop any", and the new comparable-players
  definition; `checkNumbers` accepts a reply quoting ceiling numbers.
- **Route** (`server.test.js`): `report` validation (400 on a bad code), a night request and the
  default request are cached and de-duplicated under different keys, the 404 for an unknown
  code, `facts.nights` present on the default response, thresholds still never force a refetch.
- **Browser**: headless-Chrome CDP smoke against the local server with WCL live — the select
  lists Rotminster's nights, picking one and clicking fetches with `report=`, the report shows
  "raid night of", "Where you stand" is present, reload keeps the selection. Then the same smoke
  against production after deploy.
- **Calibration**: run Dotwin (three kills on Morogrim, five bosses) and Rotminster live and
  paste both reports in the final summary, with the crit numbers before and after.

## 11. Out of scope

- Targeting the raid's own parse threshold instead of the leaderboard median (would key the
  reference cache on per-raid settings). Noted as the natural follow-up.
- More than two pulls per boss; a constant makes it easy later.
- Analysing wipes (ranks exist only for kills) and nights with no kill.
- Cross-night trend text ("better than last week").
