# Logs-first vetting and feedback — design

Date: 2026-09-07. Status: approved in chat, awaiting implementation plan.

## Problem

Two symptoms reported on 2026-09-07 for Utopik (Rogue, Spineshatter EU, guild Animal Kingdom):

1. The feedback report cannot find yesterday's Hyjal raid (2026-09-06) in its night picker,
   no matter how often it is refreshed.
2. Refreshing takes about a minute.

Both were measured against the live Warcraft Logs API before this design was written.

### Root cause of (1): tier gating hides the other tier's nights

`selectGating` in `vet-profile.js` ranks both the requested zone (1060, BT / Hyjal) and its
previous tier (1056, SSC / TK) and gates the profile on whichever has the higher median.
Utopik: SSC / TK 59.7 > BT / Hyjal 55.8, so `profile.parses` is the SSC / TK blob and BT / Hyjal
lands in `profile.parses.other`.

`fetchFeedback` and `pickKills` in `vet-feedback.js` read `profile.parses.bosses` only. So the
`encounterRankings` query is asked about SSC / TK encounters only, and `buildNights` can only ever
list SSC / TK nights. Yesterday's two Hyjal logs (`X6mnbPQpGhjJC2TN`: Winterchill, Anetheron,
Kaz'rogal, Azgalor; `ktjzamNDCK2Af6TH`: Archimonde) are ranked on WCL and are structurally
unreachable from the report.

### Root cause of (2): the cheap part is behind the expensive part

Measured, one player, full feedback run: **143 WCL requests, 45 s** — 4 for the profile, 139 for
the per-pull analysis (8 bosses × up to 2 pulls, each with fight tables and a leaderboard
reference scan). The night list itself costs the profile plus **one** `encounterRankings`
request: 5 requests, 2.7 s. Today the user pays the 45 s before being shown the picker that
would have let them choose a much smaller analysis.

The vetting page has the same shape of problem: `/api/vet/player` is 4 sequential requests per
character (character + up to 3 report probes + 2 rankings), ~100 requests for a 25-man roster,
and the gear it finds is "the last fight of whichever of the character's last 3 reports had a
combatant row" — possibly a different night, raid or spec. One report's `CombatantInfo` gives
the whole raid's gear, talents and class: measured 25 players in 2 requests, 1.5 s.

## Goals

- A raid night the guild logged is always findable, regardless of which tier the player parses
  better in.
- The user sees what can be chosen before paying for the analysis.
- Vetting a whole raid from the log it was in is the fast path; vetting by name still works.
- No change to the vetting verdict of a player vetted by name (tier gating in
  `fetchProfile` is untouched).

Non-goals: changing the checklist, the reference selection, the gap accounting, or the vetting
thresholds; any change to the Assignments page.

## Part A — Feedback report

### A1. Bosses come from both tiers

New helper in `vet-feedback.js`:

```js
// Every killed boss the profile knows about, across the gating tier and the other tier,
// each tagged with the tier it belongs to.
function killedBosses(parses) -> [{ encounterId, name, medianPercent, zone, zoneName }]
```

`fetchFeedback` and `pickKills` both use it in place of `profile.parses.bosses`. `buildNights`
carries `zone`/`zoneName` onto each night (a night's tier is its first boss's tier — one report
never mixes tiers on WCL). Each `kills[]` entry in the facts sheet also carries `zoneName`.

`encounterRankQuery` is unchanged; it now receives up to ~24 encounter ids. Verified live that
18 aliases in one request answer in 0.6 s.

`KILL_LIMIT` (8) is unchanged: "Across all kills" picks the 8 lowest medians from the union.

### A2. `facts.tiers`

`buildFacts` keeps `facts.tier` (the gating tier — existing consumers and tests) and adds

```js
tiers: [{ zone, zoneName, medianPercent }]   // every tier with kills, requested zone first
```

`feedback.js` renders the "Across kills" headline from `tiers`:
`BT / Hyjal 55.8 · SSC / TK 59.7` — two real WCL numbers, never a blended average. The
title's tier label becomes the requested zone's name. Per-night headline is unchanged.

### A3. Nights endpoint

`GET /api/vet/nights?name&server&region&zone` — same validation as `/api/vet/player`.
Server side: `loadProfile` (cached 15 min) + `VetFeedback.fetchNights(query, { profile })`,
which runs the one `encounterRankQuery` and returns `{ nights, tiers }`. Cached 15 min under
the same key scheme as the feedback cache with a `nights` suffix. 404 when the character is
unknown, `{ nights: [] }` when it has no kills.

### A4. Picker first

`feedback.js` load order:

1. No `report` param → fetch `/api/vet/nights`, render the picker with "Across all kills" +
   every night (`date · tier · N bosses · median`), status line "Choose a raid night, or
   analyse across all kills." Nothing else runs. The Copy and WCL-link controls stay disabled.
2. `report=<code>` present (chosen from the picker, or from a vetting Report link) → today's
   flow: fetch `/api/vet/feedback&report=…`, render. The picker is still rendered (from the
   facts sheet's `nights`, as now) so the user can switch.
3. Choosing "Across all kills" navigates with `all=1`; that runs the full analysis. The bare URL
   (no `report`, no `all`) never runs the analysis.

Night change keeps navigating via `location.href` as today. The local cache stays keyed by
report; nights are additionally cached client-side under `raidFeedbackNights:<key>` for 15 min
so reopening is instant.

## Part B — Vetting from a log

### B1. `wcl-logs.js` (Node, query injected like `vet-profile.js`)

```js
fetchGuildReports(query, { guild, server, region, limit = 15 })
  -> [{ code, title, date, startTime, zone: { id, name } }]      // newest first

fetchReportRoster(query, { code })
  -> { code, title, date, startTime, zone, guild: { name, server, region } | null,
       fights: [{ id, name, kill }],
       players: [{ name, server, classToken, combatant, fightId, fightName }] }
```

`fetchReportRoster` is two requests: report meta (`title startTime zone guild masterData.actors
fights(killType:Encounters)`), then one request with a `CombatantInfo` alias per encounter
fight (`f<id>:events(dataType:CombatantInfo,fightIDs:[id],limit:100){data}`). Wipes are
included — gear worn on a wipe is still the gear. Per player, the latest fight's row wins.
`sourceID` → name/server via `masterData.actors`. Reports with no encounter fights return
`players: []`.

Accepted input for "a log": a bare report code (`[A-Za-z0-9]{16}`) or a WCL URL containing
`/reports/<code>`; `parseReportCode(str)` lives in `vet-engine.js` (shared with the browser).

### B2. Rankings split out of `fetchProfile`

`vet-profile.js`: the code after the combatant loop becomes

```js
fetchRankings(query, { name, server, region, zone, classToken, talentSplit })
  -> { det, metric, rankings, rankingsZone, fallback, otherRankings, otherZone, specRankings }
```

`fetchProfile` calls it — no behaviour change, guarded by the existing profile tests. A second
export, `profileFromCombatant({ name, server, region, zone, classToken, combatant, report,
dbIndex })`, builds a profile with `parses: null, parsesPending: true` through `buildProfile`
so the log path and the name path share every gear/stat rule. `buildProfile` skips the
"no parses in …" `missing` entry while `parsesPending` is set; the parses merge adds it if the
rankings come back empty.

### B3. Routes

- `GET /api/wcl/logs?guild&server&region` → `fetchGuildReports`, cached 5 min. Validation:
  guild 2–48 chars, no `/\"`; server/region as elsewhere.
- `GET /api/wcl/log/:code/roster?zone` → `fetchReportRoster`, then per player
  `profileFromCombatant`; response `{ report: {code,title,date,zone,guild}, players:
  [profile] }`. Cached 15 min. 404 on an unknown or private report; the WCL error mapper
  (`wclErrorResponse`) covers 429.
- `GET /api/vet/parses?name&server&region&zone[&class&talents]` → `fetchRankings` +
  `buildParses`; response `{ parses, identity }` (identity re-detected with the rankings'
  spec label when the caller's talents did not resolve one). Cached 15 min.

`/api/vet/player` is untouched.

### B4. Vetting page

- Settings strip gains **Guild** next to realm/region, stored in the shared `a.wcl` blob
  (`a.wcl.guild`). Empty guild is fine: the log control then accepts a pasted code/URL only, and
  the first loaded report's `guild` auto-fills the field.
- New control next to the name box: **Load from log** — a select listing the guild's recent
  nights (`date · zone · title`) plus a text field for a code/URL, one Load button.
- Loading a log: `GET /api/wcl/log/:code/roster`; every player is added (dedup by lower-case
  name, existing rows replaced), `state.profiles[key]` = the pending profile, and the player
  entry records `source: { report: code, date, zone }` and `server` from the actor. Then each
  player is enqueued for parses through the existing `queue`/`pump` (CONCURRENCY 3, 429 pause)
  — `fetchOne` fetches `/api/vet/parses` for a pending profile and `/api/vet/player` otherwise,
  and merges `parses`/`identity` into the profile, clearing `parsesPending`.
- Rendering while pending: the parse cell shows a spinner, the verdict cell shows "…", the
  row is not counted in the summary's pass/warn/fail totals (counted as "pending"). vet-engine
  is unchanged; the overlay is purely client-side. Once merged, the profile is shape-identical
  to `/api/vet/player` output and renders through the existing path.
- **Refresh all**: rows with a `source.report` re-load from that report (one roster request per
  distinct report) and re-stream parses; rows without one refetch `/api/vet/player` as today.
- **Report link** (`feedbackUrl`) adds `&report=<code>` for rows with a `source.report`, so the
  feedback page opens on that night.
- `lastSeen` for a log-loaded row is the log itself (`reportCode`, `fightName`, `timestamp` =
  report `startTime`), so the stale rule reads the night's date.

## Error handling

- 429 anywhere: the vetting page's existing pause/resume; the feedback page's existing
  "rate limit reached" message. A roster load hit by 429 shows the message and leaves the table
  as it was.
- Unknown/private report: "Warcraft Logs could not open report <code>" in `rosterNotice`.
- A player in the log who is unknown to WCL rankings (never ranked): parses `null`, pending
  cleared, `missing` gets "no parses in either tier" — the verdict is `unverified`, as today.
- Nights endpoint with no kills: the picker shows only "Across all kills" (disabled, "no ranked
  kills") and the status line says so.

## Testing

TDD throughout. In order:

1. `vet-feedback.test.js`: a profile gated on SSC / TK whose `other` is BT / Hyjal, with
   stubbed `encounterRankings` for both, must yield the Hyjal nights (fails today) and tag each
   night with its tier; `pickKills` returns bosses from both tiers; `buildFacts` exposes
   `tiers`; `fetchNights` returns `{ nights, tiers }` in one query.
2. `vet-profile.test.js` / `server.test.js`: `fetchRankings` extraction keeps existing
   profile output byte-identical (snapshot from the current stub); `profileFromCombatant`
   yields `parsesPending: true` and the same gear summary `buildProfile` would.
3. `wcl-logs.test.js` (new): roster parsing from a stubbed report — latest fight wins, wipes
   included, sourceID mapping, empty fights, `parseReportCode` on bare codes and URLs.
4. `server.test.js`: the four routes — validation, cache hit headers, 404 mapping, 429
   propagation.
5. Client: the headless-Chrome CDP harness (see the verification-harness memory) — load a log
   from a stubbed server, assert the table renders 25 rows before any parse response arrives,
   then that verdicts resolve as parses stream; feedback page opens with the picker and no
   analysis request.

## Files

`vet-feedback.js`, `vet-profile.js`, `vet-engine.js` (parseReportCode), new `wcl-logs.js`,
`server.js`, `feedback.js`, `feedback.html`, `vetting.js`, `vetting.html`, `vetting.css`, tests
above, `README.md` (vetting and feedback bullets).

## Out of scope, noted for later

- Cross-realm players in a log: `server` is carried per player but the realm/region inputs
  stay global.
- A night older than `NIGHT_LIMIT` (10) still only resolves by explicit `report=`.
- Reference/leaderboard cost per pull is unchanged; a single night is cheaper only because it
  covers fewer bosses.
