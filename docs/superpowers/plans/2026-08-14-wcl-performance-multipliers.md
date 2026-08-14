# WCL Performance Multipliers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-fill the existing per-player DPS multiplier (`state.playerMeta[name].mult`) from Warcraft Logs parses, as an editable prefill: a player's 4-week median parse per boss, divided by what the rest of the roster manages on that boss after correcting for spec with the engine's `BASELINE`.

**Architecture:** A new pure UMD module `wcl-mult.js` (loaded by both browser and server, same wrapper as `assignments-engine.js`) holds all math and mapping; `server.js` gains a WCL OAuth token cache and one proxy endpoint for per-player parses; `assignments.js` gains realm/region settings, a fetch button and prefill logic in the existing Player tuning panel. The engine (`assignments-engine.js`) is **not touched** — `mult` already flows through the score.

**Tech Stack:** Node ≥18 (built-in `fetch`), Express 4, vanilla JS front end, WCL API v2 (GraphQL, client-credentials OAuth). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-14-wcl-performance-multipliers-design.md`

> **Revision 2026-08-14, after the Task-4 live probe.** The original plan divided each parse by
> a **global spec median** swept from WCL's ranking population and cached for 7 days. The probe
> proved that unreachable: `characterRankings.count` is the per-page item count, not the
> population size, and the API refuses pages past 20 — so at most 2,000 of a spec's ~200,000
> ranked parses are visible, and their "median" is roughly the 1,000th best parse in the world.
> The user ruled the global denominator out. Spec §2 now normalizes against the roster itself.
>
> Consequences: **Tasks 1–3 are already committed** and stay in history, but Task 2's
> `medianPageTarget` and Task 1's `WCL_SPECS` are now dead code, and Task 3's `computeMult` is
> superseded. Task 4 removes the dead code and records the zone id; Task 5 replaces the math;
> Task 6 is the single remaining endpoint (the old Tasks 5 and 6 merged, minus the sweep and
> its file cache); Tasks 7–8 are re-pointed at the two-pass flow.

## Global Constraints

- Multiplier clamp **[0.5, 2.0]**, rounded to **0.01** (spec §2).
- Parse window: **last 4 weeks** (28 × 24 × 3600 × 1000 ms), passed as `nowMs` parameter — no hidden clock in pure code (spec §2/§4).
- Same-spec parses only; healers (BASELINE 0) are never fetched, never prefilled, and never contribute to a boss's roster scale (spec §2).
- A boss contributes only when at least **3** rostered players have a qualifying parse on it (spec §2).
- `wcl-mult.js` never depends on `assignments-engine.js` — the caller passes each player's `baseline` in (spec §4).
- Credentials `WCL_CLIENT_ID` / `WCL_CLIENT_SECRET` in gitignored `.env`; missing creds → HTTP 503 with a clear message (spec §3). Never print, log or commit their values.
- Upstream error handling covers all three observed shapes: non-2xx status, a GraphQL `errors` array at HTTP 200, and a bare `error` string at HTTP 200 with no `errors` array (spec §3).
- Overwrite rule: a fetch sets `mult` only when the user hasn't manually diverged (`shouldOverwrite`, already implemented); `multAuto` always updates (spec §5).
- GraphQL goes to the **`classic.`** host, not `www.` — `characterData` is host-scoped and `www` answers `character:null` for every real Anniversary character (verified live over 14 characters). The OAuth token endpoint stays on `www.warcraftlogs.com/oauth/token`.
- `startTime` on a rank entry is epoch **milliseconds** (verified: `1782322959488` → 2026-06-24), so the window arithmetic needs no conversion.
- Zone 1056 carries WCL spec labels the engine has no concept of — `Champion`, `Gladiator`, `Justicar`, `Warden`, `Dreamstate` — and one character's `ranks[]` can mix several specs. `specNameToKey` returns null for these, so such parses are dropped by the same-spec filter (spec §2, defensive). That is the intended safe failure: a player whose parses are all under an unmapped label gets **no prefill** rather than a wrong one, and Task 7 must name them separately in the status line so the gap is visible.
- WCL zone is **1056** (SSC/TK, Anniversary), verified live 2026-08-14. Decoys: `1010` = 2021 TBC Classic, `1052` = Titan Reforged. `worldData.zones` never lists 1056 — address the zone by id. Encounter ids are the 2021 ids +100000 and a bare 2021 id silently resolves to the wrong tier.
- Tests run with `node wcl-mult.test.js` (same homemade `test(name, fn)` runner as `assignments-engine.test.js`). Run `node assignments-engine.test.js` too before every commit, to prove the engine is untouched. `npm test` runs both.
- Spec §6: `server.js` has no test harness and starting Express in tests is out of scope; the endpoint is covered by the live runs in Tasks 6 and 8. This is the plan of record.

---

### Task 1: `wcl-mult.js` skeleton — spec-name mapping and spec list

**Status: DONE** — commit `c51e1d9`. Created `wcl-mult.js` (UMD wrapper, `DEFAULT_ZONE` placeholder, `specNameToKey`, `WCL_SPECS`), `wcl-mult.test.js`, and the `npm test` script. `WCL_SPECS` is superseded by the revision — Task 4 removes it.

---

### Task 2: `medianPageTarget` and `shouldOverwrite`

**Status: DONE** — commit `47efdf7`. `shouldOverwrite` survives unchanged. `medianPageTarget` is superseded by the revision — Task 4 removes it.

---

### Task 3: `computeMult` — the multiplier itself

**Status: DONE, SUPERSEDED** — commit `875c774`. `computeMult` divided by a global spec median that the API cannot supply. Task 5 replaces it with `playerBossMedians` + `computeRosterMults`.

---

### Task 4: Record the verified zone and remove the superseded exports

**Files:**
- Modify: `wcl-mult.js`
- Modify: `wcl-mult.test.js`

**Interfaces:**
- Produces: `DEFAULT_ZONE = 1056`. Removes `WCL_SPECS` and `medianPageTarget` from the module's exports and body. `specNameToKey` and `shouldOverwrite` are unchanged.
- Nothing consumes the removed exports — the medians sweep they served no longer exists.

- [ ] **Step 1: Replace the `WCL_SPECS` test with a mapping-coverage test**

In `wcl-mult.test.js`, delete the `WCL_SPECS: 22 non-healer specs…` test and the three `medianPageTarget` tests. In place of the deleted `WCL_SPECS` test, add:

```js
test('specNameToKey covers every damage-dealing engine spec, in both name forms', () => {
    const E = require('./assignments-engine.js');
    const damage = Object.keys(E.BASELINE).filter(k => E.BASELINE[k] > 0);
    assert.strictEqual(damage.length, 23);
    damage.forEach(key => {
        const cls = key.slice(0, key.indexOf(':'));
        const spec = key.slice(key.indexOf(':') + 1);
        assert.strictEqual(W.specNameToKey(cls, spec), key);
        // WCL writes multi-word spec names without the space ("BeastMastery").
        assert.strictEqual(W.specNameToKey(cls, spec.replace(/\s+/g, '')), key);
    });
});
```

This is a stronger guarantee than the list it replaces: it fails if the engine ever gains a damage spec the mapping can't produce, and it covers `DRUID:Guardian`, which the live probe confirmed is rankable on zone 1056.

- [ ] **Step 2: Run to verify the new test fails**

Run: `node wcl-mult.test.js`
Expected: the new test FAILS — `W.specNameToKey` is fine, but the count assertion runs against a module that still exports the old surface, and the deleted tests must no longer appear. Capture the real output. (If the new test happens to pass immediately because `specNameToKey` already covers all 23, say so explicitly in the report and treat Step 3 as removal-only — do **not** fabricate a failure.)

- [ ] **Step 3: Remove the dead code and set the zone**

In `wcl-mult.js`: delete the `WCL_SPECS` array and the `medianPageTarget` function, remove both from the returned object, and replace the zone placeholder with:

```js
    // Verified live 2026-08-14 against WCL API v2: zone 1056 is the Anniversary SSC/TK tier.
    // 1010 is the 2021 TBC Classic tier and 1052 is Titan Reforged — both are wrong here, and
    // worldData.zones is stale and never lists 1056, so it must be addressed by id.
    const DEFAULT_ZONE = 1056;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: engine suite passes, then the wcl suite passes with the reduced test count.

- [ ] **Step 5: Commit**

```bash
git add wcl-mult.js wcl-mult.test.js
git commit -m "feat: verified WCL zone 1056; drop the superseded global-median helpers"
```

---

### Task 5: `playerBossMedians` and `computeRosterMults` — the multiplier itself

**Files:**
- Modify: `wcl-mult.js`
- Modify: `wcl-mult.test.js`

**Interfaces:**
- Produces: `playerBossMedians({ ranksByEncounter, classKey, specKey, nowMs, windowMs? }) -> { [encounterId]: medianAmount }` — one player's per-boss median after the 4-week window and same-spec filters. Bosses with no qualifying parse are absent.
- Produces: `computeRosterMults({ players, nowMs, windowMs?, minPlayersPerBoss? }) -> { [playerName]: { mult, bosses } }` where `players` is `[{ name, classKey, specKey, baseline, ranksByEncounter }]`. Players with no qualifying data are absent from the result.
- Replaces: `computeMult` (delete it and its six tests).

- [ ] **Step 1: Write the failing tests**

In `wcl-mult.test.js`, delete the `--- Task 3: computeMult ---` block entirely (the `NOW`/`DAY`/`mkOpts` helpers and all six `computeMult` tests) and put this in its place:

```js
// --- Roster-relative multipliers ---
const NOW = 1770000000000; // fixed fake "now"; startTimes are offsets from it
const DAY = 24 * 3600 * 1000;

// One roster entry. amountsByBoss maps encounter id -> a single amount or an array of them.
// `specName` is the WCL-side label written onto every parse; it defaults to matching specKey,
// so a test can make it disagree to exercise the same-spec filter.
function mkPlayer(name, baseline, amountsByBoss, over) {
    const o = Object.assign({ classKey: 'MAGE', specKey: 'MAGE:Fire', specName: 'Fire' }, over);
    const ranksByEncounter = {};
    Object.keys(amountsByBoss || {}).forEach(b => {
        ranksByEncounter[b] = [].concat(amountsByBoss[b]).map(a => ({
            amount: a, spec: o.specName, startTime: NOW - DAY,
        }));
    });
    return { name, baseline, classKey: o.classKey, specKey: o.specKey, ranksByEncounter };
}

test('playerBossMedians: per-boss median, odd and even counts', () => {
    const r = W.playerBossMedians({
        ranksByEncounter: {
            101: [900, 1000, 1100].map(a => ({ amount: a, spec: 'Fire', startTime: NOW - DAY })),
            102: [2000, 3000].map(a => ({ amount: a, spec: 'Fire', startTime: NOW - DAY })),
        },
        classKey: 'MAGE', specKey: 'MAGE:Fire', nowMs: NOW,
    });
    assert.deepStrictEqual(r, { 101: 1000, 102: 2500 });
});
test('playerBossMedians: parses outside the 4-week window are ignored', () => {
    const r = W.playerBossMedians({
        ranksByEncounter: {
            101: [
                { amount: 5000, spec: 'Fire', startTime: NOW - 29 * DAY }, // too old
                { amount: 1050, spec: 'Fire', startTime: NOW - 27 * DAY },
            ],
        },
        classKey: 'MAGE', specKey: 'MAGE:Fire', nowMs: NOW,
    });
    assert.deepStrictEqual(r, { 101: 1050 });
});
test('playerBossMedians: off-spec parses are ignored, and a boss with none drops out', () => {
    const r = W.playerBossMedians({
        ranksByEncounter: {
            101: [
                { amount: 5000, spec: 'Arcane', startTime: NOW - DAY },
                { amount: 980, spec: 'Fire', startTime: NOW - DAY },
            ],
            102: [{ amount: 4000, spec: 'Arcane', startTime: NOW - DAY }],
        },
        classKey: 'MAGE', specKey: 'MAGE:Fire', nowMs: NOW,
    });
    assert.deepStrictEqual(r, { 101: 980 });
});

test('computeRosterMults: a uniform roster is all 1.0', () => {
    const r = W.computeRosterMults({ nowMs: NOW, players: [
        mkPlayer('A', 1000, { 101: 1000 }),
        mkPlayer('B', 1000, { 101: 1000 }),
        mkPlayer('C', 1000, { 101: 1000 }),
    ] });
    assert.deepStrictEqual(r, {
        A: { mult: 1, bosses: 1 }, B: { mult: 1, bosses: 1 }, C: { mult: 1, bosses: 1 },
    });
});
test('computeRosterMults: BASELINE carries the cross-spec scale', () => {
    // A is a 1000-baseline mage doing 1200; B and C are 2000-baseline hunters on baseline.
    // The roster scale is median(1.2, 1.0, 1.0) = 1.0, so only A moves.
    const r = W.computeRosterMults({ nowMs: NOW, players: [
        mkPlayer('A', 1000, { 101: 1200 }),
        mkPlayer('B', 2000, { 101: 2000 }, { classKey: 'HUNTER', specKey: 'HUNTER:Beast Mastery', specName: 'BeastMastery' }),
        mkPlayer('C', 2000, { 101: 2000 }, { classKey: 'HUNTER', specKey: 'HUNTER:Beast Mastery', specName: 'BeastMastery' }),
    ] });
    assert.deepStrictEqual(r.A, { mult: 1.2, bosses: 1 });
    assert.deepStrictEqual(r.B, { mult: 1, bosses: 1 });
});
test('computeRosterMults: the per-boss scale absorbs a fight that pays double', () => {
    // Boss 102 pays exactly 2x boss 101 for everyone, so nobody's multiplier moves.
    const r = W.computeRosterMults({ nowMs: NOW, players: [
        mkPlayer('A', 1000, { 101: 900, 102: 1800 }),
        mkPlayer('B', 1000, { 101: 1000, 102: 2000 }),
        mkPlayer('C', 1000, { 101: 1100, 102: 2200 }),
    ] });
    assert.deepStrictEqual(r.A, { mult: 0.9, bosses: 2 });
    assert.deepStrictEqual(r.C, { mult: 1.1, bosses: 2 });
});
test('computeRosterMults: the scale is a median, so one hero does not move it', () => {
    const r = W.computeRosterMults({ nowMs: NOW, players: [
        mkPlayer('A', 1000, { 101: 1000 }),
        mkPlayer('B', 1000, { 101: 1000 }),
        mkPlayer('C', 1000, { 101: 1000 }),
        mkPlayer('D', 1000, { 101: 1500 }),
    ] });
    assert.strictEqual(r.A.mult, 1);   // a mean-based scale would drag this to 0.89
    assert.strictEqual(r.D.mult, 1.5);
});
test('computeRosterMults: a boss under the 3-player floor is skipped', () => {
    const r = W.computeRosterMults({ nowMs: NOW, players: [
        mkPlayer('A', 1000, { 101: 1000, 102: 1000 }),
        mkPlayer('B', 1000, { 101: 1000 }),
        mkPlayer('C', 1000, { 101: 1000 }),
        mkPlayer('D', 1000, { 102: 5000 }), // only on the 2-player boss
    ] });
    assert.deepStrictEqual(r.A, { mult: 1, bosses: 1 }); // boss 102 contributed nothing
    assert.strictEqual(r.D, undefined);                  // no qualifying boss at all
});
test('computeRosterMults: minPlayersPerBoss is overridable', () => {
    const players = [mkPlayer('A', 1000, { 101: 1000 }), mkPlayer('B', 1000, { 101: 2000 })];
    assert.deepStrictEqual(W.computeRosterMults({ nowMs: NOW, players }), {});
    const r = W.computeRosterMults({ nowMs: NOW, players, minPlayersPerBoss: 2 });
    assert.strictEqual(r.A.mult, 0.67); // scale = median(1, 2) = 1.5 -> 1000/1500
    assert.strictEqual(r.B.mult, 1.33);
});
test('computeRosterMults: clamps to [0.5, 2]', () => {
    const r = W.computeRosterMults({ nowMs: NOW, players: [
        mkPlayer('A', 1000, { 101: 1000 }),
        mkPlayer('B', 1000, { 101: 1000 }),
        mkPlayer('C', 1000, { 101: 1000 }),
        mkPlayer('HI', 1000, { 101: 9000 }),
        mkPlayer('LO', 1000, { 101: 10 }),
    ] });
    assert.strictEqual(r.HI.mult, 2);
    assert.strictEqual(r.LO.mult, 0.5);
});
test('computeRosterMults: zero-baseline players are excluded and do not move the scale', () => {
    const r = W.computeRosterMults({ nowMs: NOW, players: [
        mkPlayer('A', 1000, { 101: 1000 }),
        mkPlayer('B', 1000, { 101: 1000 }),
        mkPlayer('C', 1000, { 101: 1000 }),
        mkPlayer('Healer', 0, { 101: 400 }),
    ] });
    assert.strictEqual(r.Healer, undefined);
    assert.strictEqual(r.A.mult, 1); // scale unchanged by the excluded entry
});
test('computeRosterMults: a player with no qualifying parses is absent', () => {
    const r = W.computeRosterMults({ nowMs: NOW, players: [
        mkPlayer('A', 1000, { 101: 1000 }),
        mkPlayer('B', 1000, { 101: 1000 }),
        mkPlayer('C', 1000, { 101: 1000 }),
        mkPlayer('Offspec', 1000, { 101: 1000 }, { specKey: 'MAGE:Arcane' }), // rostered Arcane, parses say Fire
        mkPlayer('Empty', 1000, {}),                                          // no parses at all
    ] });
    assert.strictEqual(r.Offspec, undefined);
    assert.strictEqual(r.Empty, undefined);
    assert.strictEqual(Object.keys(r).length, 3);
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node wcl-mult.test.js`
Expected: the `specNameToKey`/`shouldOverwrite` tests still pass; every new test FAILS with `W.playerBossMedians is not a function` / `W.computeRosterMults is not a function`. Capture the real output.

- [ ] **Step 3: Implement**

In `wcl-mult.js`, delete `computeMult` and add (keep the existing private `median` helper):

```js
    const WINDOW_MS = 28 * 24 * 3600 * 1000;   // spec §2: the last 4 weeks
    const MIN_PLAYERS_PER_BOSS = 3;            // spec §2: below this the boss scale is noise

    // One player's median parse per boss, after the window and same-spec filters. A boss the
    // player never qualified on is absent rather than zero — callers distinguish the two.
    function playerBossMedians(opts) {
        const windowMs = opts.windowMs || WINDOW_MS;
        const ranks = opts.ranksByEncounter || {};
        const out = {};
        Object.keys(ranks).forEach(function (encId) {
            const amounts = (ranks[encId] || [])
                .filter(r => r && typeof r.amount === 'number' && typeof r.startTime === 'number')
                .filter(r => opts.nowMs - r.startTime <= windowMs)
                .filter(r => specNameToKey(opts.classKey, r.spec) === opts.specKey)
                .map(r => r.amount);
            const m = median(amounts);
            if (m !== null && m > 0) out[encId] = m;
        });
        return out;
    }

    // spec §2. Three passes: each player's per-boss median; one scale per boss fitted from the
    // roster; then every player's ratio against that scale, averaged over their bosses.
    function computeRosterMults(opts) {
        const windowMs = opts.windowMs || WINDOW_MS;
        const minPlayers = opts.minPlayersPerBoss || MIN_PLAYERS_PER_BOSS;
        const entries = (opts.players || [])
            .filter(p => p && p.baseline > 0)
            .map(p => ({
                name: p.name,
                baseline: p.baseline,
                medians: playerBossMedians({
                    ranksByEncounter: p.ranksByEncounter, classKey: p.classKey,
                    specKey: p.specKey, nowMs: opts.nowMs, windowMs: windowMs,
                }),
            }));

        // The scale absorbs whatever the fight itself contributes — length, adds, target count,
        // the raid's gear on the night — so a ratio compares players and not encounters. Median
        // rather than mean: one hero parse must not redefine the boss for everyone else.
        const scaleByBoss = {};
        const bosses = {};
        entries.forEach(e => Object.keys(e.medians).forEach(b => { bosses[b] = true; }));
        Object.keys(bosses).forEach(function (b) {
            const index = entries.filter(e => e.medians[b] > 0).map(e => e.medians[b] / e.baseline);
            if (index.length < minPlayers) return;
            const c = median(index);
            if (c > 0) scaleByBoss[b] = c;
        });

        const out = {};
        entries.forEach(function (e) {
            const ratios = Object.keys(e.medians)
                .filter(b => scaleByBoss[b] > 0)
                .map(b => e.medians[b] / (e.baseline * scaleByBoss[b]));
            if (!ratios.length) return;
            const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
            out[e.name] = {
                mult: Math.min(2, Math.max(0.5, Math.round(mean * 100) / 100)),
                bosses: ratios.length,
            };
        });
        return out;
    }
```

Export `playerBossMedians` and `computeRosterMults`; remove `computeMult` from the returned object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: engine suite green, then every wcl-mult test green. Paste the real output.

- [ ] **Step 5: Commit**

```bash
git add wcl-mult.js wcl-mult.test.js
git commit -m "feat: roster-relative multipliers — per-boss scale fitted from the raid itself"
```

---

### Task 6: server.js — WCL auth + `/api/wcl/player`

**Files:**
- Modify: `server.js` (add below the Raid-Helper proxy, around line 78)

**Interfaces:**
- Produces: `GET /api/wcl/player?name=&server=&region=&zone=` → `{ name, ranksByEncounter: { [encounterId]: ranks[] } }`, where `ranks[]` is WCL's `encounterRankings.ranks` passed through (entries carry `amount`, `spec`, `startTime`). Errors: 400 bad input, 404 unknown character or zone, 503 no credentials, 429 rate-limited, 502/504 upstream trouble — always JSON `{ error }`.
- No cache file and no `.gitignore` change: the medians sweep that needed one is gone.

- [ ] **Step 1: Add the WCL plumbing**

```js
// --- Warcraft Logs proxy (client-credentials OAuth; secrets live in .env) -------------
// The classic host, NOT www: `characterData` is host-scoped and www returns character:null for
// every real Anniversary character. Verified live 2026-08-14 — www answered null for all 14
// characters probed, classic answered all of them. worldData works on either host.
const WCL_API = 'https://classic.warcraftlogs.com/api/v2/client';

let wclToken = null; // { token, expiresAt } — cached until shortly before expiry
async function getWclToken() {
  if (!process.env.WCL_CLIENT_ID || !process.env.WCL_CLIENT_SECRET) {
    const e = new Error('WCL API credentials not configured (WCL_CLIENT_ID / WCL_CLIENT_SECRET in .env)');
    e.code = 'NO_CREDS';
    throw e;
  }
  if (wclToken && Date.now() < wclToken.expiresAt - 60000) return wclToken.token;
  const res = await fetch('https://www.warcraftlogs.com/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(process.env.WCL_CLIENT_ID + ':' + process.env.WCL_CLIENT_SECRET).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error('WCL token request failed: ' + res.status);
  const data = await res.json();
  wclToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return wclToken.token;
}

async function wclQuery(query, variables) {
  const token = await getWclToken();
  const res = await fetch(WCL_API, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 429) { const e = new Error('WCL rate limit reached — try again later'); e.code = 'RATE_LIMIT'; throw e; }
  if (!res.ok) throw new Error('WCL returned ' + res.status);
  const data = await res.json();
  if (data.errors && data.errors.length) throw new Error('WCL GraphQL: ' + data.errors[0].message);
  // WCL reports some failures as a bare `error` string at HTTP 200 with no `errors` array,
  // so a check on status and `errors` alone would read those as success.
  if (typeof data.error === 'string') throw new Error('WCL: ' + data.error);
  return data.data;
}

// A zone's encounter list is static, so resolve it once per process. worldData.zones is stale
// and omits the Anniversary tier entirely, so the zone is addressed by id and never looked up
// in the list.
const wclZoneEncounters = new Map();
async function getZoneEncounters(zone) {
  if (wclZoneEncounters.has(zone)) return wclZoneEncounters.get(zone);
  const zd = await wclQuery('query($zone:Int!){worldData{zone(id:$zone){name encounters{id name}}}}', { zone });
  const z = zd.worldData && zd.worldData.zone;
  if (!z || !Array.isArray(z.encounters) || !z.encounters.length) return null;
  wclZoneEncounters.set(zone, z.encounters);
  return z.encounters;
}

function wclErrorResponse(res, err, what) {
  console.error(what + ' failed:', err);
  if (err.code === 'NO_CREDS') return res.status(503).json({ error: err.message });
  if (err.code === 'RATE_LIMIT') return res.status(429).json({ error: err.message });
  if (err.name === 'AbortError' || err.name === 'TimeoutError') {
    return res.status(504).json({ error: what + ' timed out' });
  }
  res.status(502).json({ error: err.message || (what + ' failed') });
}
```

- [ ] **Step 2: Add the endpoint**

```js
app.get('/api/wcl/player', async (req, res) => {
  const name = String(req.query.name || '');
  const server = String(req.query.server || '').toLowerCase();
  const region = String(req.query.region || '').toLowerCase();
  const zone = parseInt(req.query.zone, 10);
  if (!/^[^\s\/\\"]{2,24}$/.test(name)) return res.status(400).json({ error: 'Invalid character name' });
  if (!/^[a-z0-9-]{2,40}$/.test(server)) return res.status(400).json({ error: 'Invalid server slug' });
  if (!/^(eu|us|kr|tw|cn)$/.test(region)) return res.status(400).json({ error: 'Invalid region' });
  if (!Number.isInteger(zone) || zone <= 0) return res.status(400).json({ error: 'Invalid zone id' });
  try {
    const encounters = await getZoneEncounters(zone);
    if (!encounters) return res.status(404).json({ error: 'Unknown WCL zone ' + zone });
    // One query, one alias per encounter. encounterRankings is a JSON scalar in WCL's schema,
    // so per-field selection is neither possible nor needed.
    const aliases = encounters
      .map(e => 'e' + e.id + ': encounterRankings(encounterID:' + e.id + ',metric:dps)')
      .join(' ');
    const q = 'query($name:String!,$server:String!,$region:String!){characterData{' +
      'character(name:$name,serverSlug:$server,serverRegion:$region){' + aliases + '}}}';
    const data = await wclQuery(q, { name, server, region });
    const ch = data.characterData && data.characterData.character;
    if (!ch) return res.status(404).json({ error: 'Character not found on Warcraft Logs' });
    const ranksByEncounter = {};
    encounters.forEach(e => {
      const blob = ch['e' + e.id];
      ranksByEncounter[e.id] = (blob && Array.isArray(blob.ranks)) ? blob.ranks : [];
    });
    res.json({ name, ranksByEncounter });
  } catch (err) { wclErrorResponse(res, err, 'WCL player lookup'); }
});
```

- [ ] **Step 3: Verify live**

Start `node server.js` in the background, then use the character/realm/region recorded in `.superpowers/sdd/2026-08-14-wcl-performance-multipliers/task-4-report.md`:

```bash
curl -s "http://localhost:3000/api/wcl/player?name=NAME&server=SLUG&region=REGION&zone=1056" \
  | node -pe 'const d=JSON.parse(require("fs").readFileSync(0));
      Object.entries(d.ranksByEncounter).map(([k,v])=>k+": "+v.length+" ranks").join("\n")'
curl -s -o /dev/null -w '%{http_code}\n' \
  "http://localhost:3000/api/wcl/player?name=Nosuchplayerxq&server=SLUG&region=REGION&zone=1056"
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:3000/api/wcl/player?name=x&server=SLUG&region=eu&zone=1056"
```

Expected: real ranks for the known character; `404` for the fake one; `400` for the too-short name. Spot-check that one rank object has `amount`, `spec` and a millisecond `startTime`. Also confirm the second call for the same zone issues no extra zone query (the encounter list is cached in memory). Check the no-credentials path once by starting the server with `WCL_CLIENT_ID= WCL_CLIENT_SECRET= node server.js` — expect 503 JSON — without editing `.env`. Stop the server. Paste the real output.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: /api/wcl/player — per-character encounter rankings proxy"
```

---

### Task 7: UI — settings, fetch button, prefill and tooltip

**Files:**
- Modify: `assignments.html:86` (add `<script src="wcl-mult.js"></script>` between the engine and `assignments.js`)
- Modify: `assignments.js` (state default, module-level status, the tuning panel in `renderGroups()` around line 464, new fetch function)
- **Do NOT modify `style.css`** — it holds unrelated uncommitted work, and `.tuning-row` / `.player-tuning` have no rules today, so the new row needs none.

**Interfaces:**
- Consumes: `WclMult.computeRosterMults`, `WclMult.shouldOverwrite`, `WclMult.DEFAULT_ZONE` (browser global via the new script tag); `/api/wcl/player` from Task 6.
- Produces: `state.wcl = { server, region }` (persisted); `state.playerMeta[name]` gains `multAuto: number` and `multInfo: { bosses, fetchedAt }`.

- [ ] **Step 1: Wire the state default**

In the `state` literal at `assignments.js:7`, add:

```js
    wcl: { server: '', region: 'eu' },   // Warcraft Logs realm slug + region for parse fetching
```

Existing saved states merge via `Object.assign`, so also guard at use: `state.wcl = state.wcl || { server: '', region: 'eu' };` at the top of both the fetch handler and the settings row builder.

Add a module-level `let wclStatus = '';` near the other module state (~line 22) — `renderAll()` rebuilds the panel, so the status string must live outside it to survive the post-fetch rerender.

- [ ] **Step 2: Add the WCL row to the Player tuning panel**

Inside the `tune` details element construction in `renderGroups()` (after `tune.appendChild(sum);`, before the `roster.forEach` rows):

```js
    // WCL performance prefill: realm/region settings, fetch button, last-fetch status.
    state.wcl = state.wcl || { server: '', region: 'eu' };
    const wclRow = document.createElement('div');
    wclRow.className = 'tuning-row wcl-row';
    const srv = document.createElement('input');
    srv.type = 'text';
    srv.placeholder = 'realm-slug';
    srv.value = state.wcl.server || '';
    srv.title = 'Warcraft Logs realm slug, e.g. "spineshatter"';
    srv.addEventListener('change', () => { state.wcl.server = srv.value.trim().toLowerCase(); saveState(); });
    const reg = document.createElement('select');
    ['eu', 'us'].forEach(r => {
        const o = document.createElement('option');
        o.value = r; o.textContent = r.toUpperCase();
        if ((state.wcl.region || 'eu') === r) o.selected = true;
        reg.appendChild(o);
    });
    reg.addEventListener('change', () => { state.wcl.region = reg.value; saveState(); });
    const fetchBtn = document.createElement('button');
    fetchBtn.type = 'button';
    fetchBtn.textContent = 'Fetch from Warcraft Logs';
    fetchBtn.title = 'Prefill multipliers from your last 4 weeks of parses, measured against the rest of this roster. Manual edits survive a refetch.';
    const status = document.createElement('span');
    status.className = 'wcl-status';
    status.textContent = wclStatus;
    fetchBtn.addEventListener('click', () => fetchWclMults(fetchBtn, status));
    wclRow.appendChild(srv); wclRow.appendChild(reg); wclRow.appendChild(fetchBtn); wclRow.appendChild(status);
    tune.appendChild(wclRow);
```

- [ ] **Step 3: The fetch function** (top level in `assignments.js`)

```js
// Every multiplier is relative to the rest of the roster (spec §2), so this fetches the whole
// roster first and computes nothing until it is all in.
async function fetchWclMults(btn, statusEl) {
    state.wcl = state.wcl || { server: '', region: 'eu' };
    if (!state.wcl.server) { statusEl.textContent = 'Set the realm slug first.'; return; }
    if (!WclMult.DEFAULT_ZONE) { statusEl.textContent = 'No WCL zone configured.'; return; }
    btn.disabled = true;
    try {
        const eligible = roster.filter(p => (E.BASELINE[E.specKey(p)] || 0) > 0);
        const fetched = [];
        const noLogs = [];    // WCL has no such character, or no parses in this zone at all
        const wrongSpec = []; // has parses, but none on the spec we have them rostered as
        for (let i = 0; i < eligible.length; i++) {
            const p = eligible[i];
            statusEl.textContent = 'Fetching ' + p.name + ' (' + (i + 1) + '/' + eligible.length + ')…';
            const url = '/api/wcl/player?name=' + encodeURIComponent(p.name) +
                '&server=' + encodeURIComponent(state.wcl.server) +
                '&region=' + (state.wcl.region || 'eu') + '&zone=' + WclMult.DEFAULT_ZONE;
            const r = await fetch(url);
            if (r.status === 404) { noLogs.push(p.name); continue; }
            if (!r.ok) throw new Error((await r.json()).error || 'player fetch failed');
            const data = await r.json();
            fetched.push({
                name: p.name, classKey: p.class, specKey: E.specKey(p),
                baseline: E.BASELINE[E.specKey(p)], ranksByEncounter: data.ranksByEncounter,
            });
        }
        statusEl.textContent = 'Computing…';
        const results = WclMult.computeRosterMults({ players: fetched, nowMs: Date.now() });
        const fetchedAt = Date.now();
        let filled = 0;
        eligible.forEach(p => {
            const result = results[p.name];
            if (!result) {
                // Separate "WCL never heard of them" from "they log, but never on this spec" —
                // the Anniversary realm has spec labels the engine has no concept of, and a
                // silent gap there is indistinguishable from a typo'd name without this.
                if (noLogs.indexOf(p.name) < 0) {
                    const got = fetched.find(f => f.name === p.name);
                    const hasParses = got && Object.keys(got.ranksByEncounter || {})
                        .some(k => (got.ranksByEncounter[k] || []).length > 0);
                    (hasParses ? wrongSpec : noLogs).push(p.name);
                }
                return;
            }
            const meta = state.playerMeta[p.name] || {};
            const next = Object.assign({}, meta, {
                multAuto: result.mult,
                multInfo: { bosses: result.bosses, fetchedAt: fetchedAt },
            });
            if (WclMult.shouldOverwrite(meta)) next.mult = result.mult;
            state.playerMeta[p.name] = next;
            filled++;
        });
        wclStatus = 'WCL: ' + filled + '/' + eligible.length + ' prefilled' +
            (noLogs.length ? ' — no logs: ' + noLogs.join(', ') : '') +
            (wrongSpec.length ? ' — no parses on their rostered spec: ' + wrongSpec.join(', ') : '');
    } catch (err) {
        wclStatus = 'WCL fetch failed: ' + err.message;
    }
    btn.disabled = false;
    saveState();
    renderAll(); // rebuilds the panel; the new status renders from wclStatus
}
```

- [ ] **Step 4: Re-word the mult tooltip and add the provenance marker**

The existing title on the mult input claims the number is relative to an average player of the spec. Spec §2 says it is now relative to this roster, so replace that line:

```js
        mult.title = 'Relative output vs the rest of this roster (gear/skill), spec-corrected';
```

and immediately after it add:

```js
        if (m.multInfo && typeof m.multAuto === 'number') {
            mult.title += ' — WCL: ' + m.multAuto + ' vs this roster, from ' + m.multInfo.bosses +
                ' boss(es), fetched ' + new Date(m.multInfo.fetchedAt).toISOString().slice(0, 10) +
                (typeof m.mult === 'number' && m.mult !== m.multAuto ? ' (manual override kept)' : '');
        }
```

- [ ] **Step 5: Script tag**

In `assignments.html`, before the `assignments.js` include:

```html
    <script src="wcl-mult.js"></script>
```

- [ ] **Step 6: Verify in the real app**

`npm test` first (all green — proves no engine regression). Then start `node server.js` and drive headless Chrome over CDP (no browser tool here — see the memory note `wowstuff-verification-harness` for the gotchas): load `http://localhost:3000/assignments.html`, seed a roster, open the Player tuning panel, set realm/region, click **Fetch from Warcraft Logs**, and screenshot. Confirm: mult inputs filled, tooltip shows the roster-relative provenance, status line lists any no-logs players, and a hand-edited mult then a re-fetch keeps the hand-edited value while updating the tooltip's auto value. Paste the real observed values in the task report.

- [ ] **Step 7: Commit**

```bash
git add assignments.html assignments.js
git commit -m "feat: WCL performance prefill — fetch button, settings and provenance tooltips"
```

---

### Task 8: End-to-end verification and finish

**Files:**
- None new — verification, then merge per the finishing workflow.

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: every engine test and every wcl-mult test passes. Paste the real tail of the output (`N passed, 0 failed` lines).

- [ ] **Step 2: End-to-end against a real roster**

Restart `node server.js` and repeat the Task-7 browser flow from a cold process (so the in-memory encounter cache starts empty). Sanity-check the distribution: multipliers should straddle 1.0, because the definition centres the roster there by construction. If every mult comes out at exactly 1.0, the per-boss scale is collapsing (likely too few players per boss); if they all clamp at 0.5 or 2.0, something is wrong with units, the zone, or the baseline lookup — stop and investigate before declaring success.

- [ ] **Step 2b: Independent cross-check against WCL's own percentiles**

Every rank entry already carries `rankPercent` (0–100, WCL's own percentile against the full ~20–28k parse pool for that spec/boss — not the 2,000-entry slice). It is not part of the definition and must not become part of it (spec §7 rules percentile ratings out of scope), but it is a free second opinion on whether the computed multipliers are sane. For the fetched roster, compare each player's mean `rankPercent` against their computed `mult`: the two should be **positively rank-correlated**. If a player near the top of the roster's percentiles lands below 1.0, or vice versa, the baseline lookup or the per-boss scale is wrong. Report the comparison as a table in the task report — this is a diagnostic, not a gate.

- [ ] **Step 3: Finish the branch**

Use superpowers:finishing-a-development-branch — merge to `main` per the repo's existing merge-commit convention.
