# WCL performance multipliers — design

**Date:** 2026-08-14
**Status:** Approved design, pending implementation plan

## 1. Problem

The group optimizer v2 scores players as `BASELINE[spec] × mult(p) × buffs`, treating every
player of a spec as identical unless the raid leader hand-edits the per-player multiplier
(`state.playerMeta[name].mult`, UI range 0.5–2.0, default 1.0). In practice players differ a
lot: a well-played mage can out-deliver a BiS warlock. Buffs and premium group seats should
flow to the players who actually produce the most damage. This feature fills the existing
multiplier automatically from Warcraft Logs data, as an **editable prefill** — the engine and
score model are untouched.

## 2. The multiplier definition

```
mult(p) = mean over bosses B of ( playerMedianAmount(p, B) / specMedianAmount(spec(p), B) )
```

- `playerMedianAmount(p, B)` = the median `amount` (DPS) of p's ranked parses on boss B
  **within the last 4 weeks**, on the spec p is rostered as. Median, not best: one lucky
  parse must not crown anyone.
- `specMedianAmount(spec, B)` = the global median DPS of that spec on that boss, taken from
  WCL's ranking population (see §4).
- Both numerator and denominator come from fully-raid-buffed logs, so buff effects cancel and
  the engine's own buff math is not double-counted. The ratio captures skill **and** gear —
  intentionally, because the optimizer maximises actual output, not fairness.
- Averaged across every boss in the configured zone where the player has ≥1 qualifying parse.
- Clamped to [0.5, 2.0] (the existing UI range), rounded to 0.01.

**Exclusions:**
- Healers are skipped entirely — their baseline is 0 by design, mult cannot matter.
- Parses on a spec other than the rostered spec do not count. If a player has no
  qualifying same-spec parses in the window, they get **no prefill**: mult stays as-is and
  the UI marks them "no logs".

## 3. Architecture

Client (assignments.js) does the math with pure functions; server.js proxies WCL (same
pattern as the existing Raid-Helper proxy — WCL's OAuth secret cannot live in the browser).

### Auth

WCL API v2 (GraphQL, unified endpoint for retail + classic). Client-credentials flow:
`WCL_CLIENT_ID` and `WCL_CLIENT_SECRET` in the gitignored `.env` (the existing `.env` reader
picks them up). The server fetches a bearer token from `https://www.warcraftlogs.com/oauth/token`
and caches it in memory until shortly before expiry. Missing credentials → endpoints answer
503 with a clear message (mirrors the OpenAI-key behavior).

### Endpoints

- `GET /api/wcl/medians?zone=<id>` — for each (boss encounter in zone × DPS/tank spec),
  query `worldData.encounter(id).characterRankings(className, specName, metric: dps)`:
  read `count` from page 1, request the middle page, take the middle entry's `amount`.
  Result cached server-side in a JSON file next to `.env` with a **7-day TTL** (~90 queries
  per refresh, not per click). `?refresh=1` busts the cache.
- `GET /api/wcl/player?name=&server=&region=&zone=` — that character's
  `characterData.character.encounterRankings` per encounter in the zone (metric dps),
  returning per-parse `amount`, `spec`, and timestamp so the client can apply the 4-week
  window and same-spec filter. Character names are URL-encoded; unknown character → 404
  passed through as "no logs".

Both endpoints validate inputs, use `AbortSignal.timeout`, and translate upstream failures
to JSON errors, matching the Raid-Helper proxy conventions. WCL rate limits are generous
relative to ~30 player queries + a weekly cached median sweep; on a 429 the endpoint
returns 429 and the client surfaces it.

### Zone and spec mapping

- The target zone (SSC/TK tier for the Anniversary partition) is a named constant. Its
  numeric WCL zone ID **must be verified against the live API during implementation** (zone
  IDs differ between Classic eras/partitions); do not trust remembered values.
- WCL spec names ("Destruction", "BeastMastery", …) map to the engine's specKeys via an
  explicit table in the new pure module. Unmapped spec names are ignored (defensive).

## 4. Client: computation module

New pure module (no DOM, unit-testable) exporting roughly:

- `computeMult(playerParses, medians, rosterSpecKey, nowMs)` → `{ mult, bosses, detail } | null`
  — applies the 4-week window, same-spec filter, per-boss median, ratio, cross-boss mean,
  clamp, rounding. Returns `null` for "no data".
- `specNameToKey(wclSpecName, wclClassName)` → specKey or null.

`nowMs` is a parameter (no hidden clock) so tests are deterministic.

## 5. UI workflow (assignments.js, Player tuning panel)

- Two new persisted settings fields: **server** (realm slug) and **region** — filled once.
- A **"Fetch from Warcraft Logs"** button. On click: load medians (server-cached), then fetch
  each eligible roster player's parses, compute mults, and write prefills.
- **Editable prefill with override protection:** `state.playerMeta[name]` gains `multAuto`
  (the last auto-computed value). A fetch overwrites `mult` only when the current `mult`
  equals the previous `multAuto` (or is unset/1.0-default) — i.e. auto values refresh, but a
  value the user has manually adjusted since the last fetch survives. Manual edits keep
  working exactly as today.
- Per-player provenance tooltip on the mult input: e.g. "6 bosses, median parse ÷ spec
  median = 1.12 (WCL, fetched 2026-08-14)". Players with no data get a "no logs" marker and
  are left untouched.
- Errors (missing API key, 429, network) surface as a visible message in the panel, not
  silently.

## 6. Testing

- **Engine:** untouched; existing tests already cover `mult` propagation.
- **Unit tests** (existing node test setup, fixture JSON of recorded WCL response shapes):
  4-week window edges, same-spec filtering, per-boss median (odd/even counts), cross-boss
  mean, clamp/rounding, no-data → null, spec-name mapping including unmapped names.
- **Prefill/override logic:** unit-test the decision function (overwrite iff `mult ===
  multAuto` or unset) separately from the DOM.
- **Server endpoints:** exercised against recorded responses (fixture-fed fetch), plus one
  manual end-to-end run against the live API during implementation to verify zone ID, spec
  names, and median-page arithmetic.

## 7. Out of scope

- Cross-spec inference (using fire parses to estimate arcane output).
- Percentile-based "skill only" ratings, blending, or ilvl-bracket normalization.
- Healer or per-boss weighting; automatic scheduled refresh; historical trending.
